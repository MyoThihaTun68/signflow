import { PDFDocument } from 'pdf-lib';
import { getRepo } from '@/lib/server/db';
import { findByToken, hasValidSession, toPublicDocument } from '@/lib/server/documents';
import { hmacHex, sha256Hex } from '@/lib/server/crypto';
import { baseUrl, cleanText, clientIp, isValidEmail, jsonError, userAgent } from '@/lib/server/http';
import { completedEmail, sendMail, signRequestEmail } from '@/lib/server/mailer';
import { getObject, putObject } from '@/lib/server/storage';
import { isP12Configured, signWithP12 } from '@/lib/server/p12';
import { dataUrlToBytes, drawStamp } from '@/lib/pdf/stamp';
import {
  DECISION_LABELS,
  normalizeRole,
  roleLabel,
  type Decision,
  type OrgRole,
  type SignerHistoryEntry,
  type StampConfig,
} from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SealBody {
  signature?: unknown;
  page?: unknown;
  cx?: unknown;
  cy?: unknown;
  widthFrac?: unknown;
  decision?: unknown;
  note?: unknown;
  signerName?: unknown;
  signerEmail?: unknown;
  signerRole?: unknown;
  /** Optional: forward to next person in the chain (e.g. HR -> Director -> Boss) instead of locking final */
  forwardToRole?: unknown;
  forwardToName?: unknown;
  forwardToEmail?: unknown;
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const repo = getRepo();
  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  if (doc.status !== 'pending_cosign') return jsonError('This document has already been finalized.', 409);
  if (!hasValidSession(req, doc))
    return jsonError('Email verification required (or expired). Verify the OTP again.', 401);

  const sourcePath = doc.final_pdf_path || doc.original_pdf_path;
  if (!sourcePath || !doc.stage1_sha256) return jsonError('Source PDF is missing.', 500);

  const body = (await req.json().catch(() => ({}))) as SealBody;
  const decision = (['approved', 'approved_with_notes', 'rejected'] as const).find((d) => d === body.decision) as
    | Decision
    | undefined;
  const page = num(body.page, 0, 10_000);
  const cx = num(body.cx, 0, 1);
  const cy = num(body.cy, 0, 1);
  const widthFrac = num(body.widthFrac, 0.04, 0.9);
  const note = cleanText(body.note, 600) || null;
  const signerName = cleanText(body.signerName, 120) || doc.signer2_name || doc.signer2_email || 'Team Signer';
  const signerEmail = cleanText(body.signerEmail, 254).toLowerCase() || doc.signer2_email || 'signer@signflow.org';
  const signerRole: OrgRole = normalizeRole(body.signerRole, doc.stamp_config?.assigned_role || 'director');
  const signature = typeof body.signature === 'string' ? body.signature : '';

  const forwardRoleRaw = cleanText(body.forwardToRole, 40);
  const forwardToRole: OrgRole | null = forwardRoleRaw ? normalizeRole(forwardRoleRaw) : null;
  const forwardToName = cleanText(body.forwardToName, 120) || null;
  const forwardToEmail = cleanText(body.forwardToEmail, 254).toLowerCase() || null;
  const isForwarding = Boolean(forwardToRole && decision !== 'rejected');

  if (!decision) return jsonError('Choose a decision.');
  if (decision === 'approved_with_notes' && !note) return jsonError('Add a note for "Approved w/ Notes".');
  if (page === null || cx === null || cy === null || widthFrac === null) return jsonError('Invalid stamp position.');
  if (!signature.startsWith('data:image/png;base64,') || signature.length > 2_500_000)
    return jsonError('Signature must be a PNG image under ~1.8 MB.');
  if (isForwarding && forwardToEmail && !isValidEmail(forwardToEmail))
    return jsonError('Enter a valid email for the next approver.');

  const sourceBytes = await getObject(sourcePath);
  if (!sourceBytes) return jsonError('PDF could not be loaded from storage.', 500);

  const ip = clientIp(req);
  const ua = userAgent(req);
  const signedAt = new Date().toISOString();

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  } catch {
    return jsonError('PDF could not be parsed.', 500);
  }
  const pageIndex = Math.floor(page);
  if (pageIndex >= pdf.getPageCount()) return jsonError('Page out of range.');

  // Embed ONLY the pure transparent signature image on the page (no extra text/email/timestamp lines on the PDF)
  let stamp;
  try {
    stamp = await drawStamp(pdf, pageIndex, dataUrlToBytes(signature), { cx, cy, widthFrac }, []);
  } catch {
    return jsonError('Signature image could not be embedded.', 400);
  }

  const signedContent = await pdf.save();
  const signedContentSha = sha256Hex(signedContent);
  const sealMethod = isP12Configured() ? 'p12' : 'hash';
  const sealValue = hmacHex(`${doc.ref_code}|${doc.stage1_sha256}|${signedContentSha}|${decision}`);
  const origin = baseUrl(req);

  pdf.setTitle(doc.title);
  pdf.setSubject(`SignFlow ${doc.ref_code}`);
  pdf.setKeywords(['SignFlow', doc.ref_code, isForwarding ? 'in_progress' : 'sealed', `seal:${sealValue.slice(0, 32)}`]);
  pdf.setProducer('SignFlow (pdf-lib)');
  pdf.setModificationDate(new Date());

  const hashSealed = await pdf.save();
  let finalBytes: Uint8Array = hashSealed;
  let appliedSeal: 'p12' | 'hash' = 'hash';
  if (!isForwarding && sealMethod === 'p12') {
    try {
      const forSigning = await PDFDocument.load(hashSealed, { updateMetadata: false });
      const p12 = await signWithP12(forSigning, signerName);
      if (p12) {
        finalBytes = p12;
        appliedSeal = 'p12';
      }
    } catch (err) {
      console.error('[signflow] P12 signing failed, falling back to hash seal:', err);
    }
  }

  const finalSha = sha256Hex(finalBytes);
  const finalPath = `final/${doc.id}.pdf`;
  await putObject(finalPath, finalBytes);

  const prevSignatures = doc.stamp_config?.signatures ?? [];
  const newEntry: SignerHistoryEntry = {
    actorName: signerName,
    actorEmail: signerEmail,
    actorRole: signerRole,
    decision,
    note,
    page: pageIndex + 1,
    signedAt,
    ipAddress: ip,
    sha256AfterSign: finalSha,
    finalSeal: !isForwarding,
  };
  const allSignatures = [...prevSignatures, newEntry];

  await repo.addEvent({
    document_id: doc.id,
    event_type: 'signed',
    actor_email: signerEmail,
    ip_address: ip,
    user_agent: ua,
    metadata: {
      decision,
      note,
      page: pageIndex + 1,
      actor_name: signerName,
      actor_role: signerRole,
      sha256: finalSha,
      forwarded_to: isForwarding ? forwardToRole : null,
    },
  });

  if (isForwarding && forwardToRole) {
    const nextEmail = forwardToEmail || `${forwardToRole.toLowerCase().replace(/\s+/g, '.')}@signflow.org`;
    const nextName = forwardToName || roleLabel(forwardToRole);
    const stampConfig: StampConfig = {
      ...doc.stamp_config,
      page: pageIndex,
      x: Number(stamp.x.toFixed(2)),
      y: Number(stamp.y.toFixed(2)),
      scale: widthFrac,
      cx,
      cy,
      decision,
      note,
      seal_method: appliedSeal,
      assigned_role: forwardToRole,
      signatures: allSignatures,
    };
    const updatedDoc = await repo.updateDocument(doc.id, {
      status: 'pending_cosign',
      signer2_name: nextName,
      signer2_email: nextEmail,
      final_pdf_path: finalPath,
      final_sha256: finalSha,
      stamp_config: stampConfig,
    });

    const signUrl = `${origin}/sign/${token}`;
    if (forwardToEmail) {
      await sendMail(
        signRequestEmail({
          to: nextEmail,
          signer2Name: nextName,
          signer1Name: `${signerName} (${roleLabel(signerRole)})`,
          signer1Email: signerEmail,
          title: doc.title,
          refCode: doc.ref_code,
          url: signUrl,
        }),
      );
    }

    await repo.addEvent({
      document_id: doc.id,
      event_type: 'sent',
      actor_email: signerEmail,
      ip_address: ip,
      user_agent: ua,
      metadata: {
        kind: 'forwarded',
        actor_name: signerName,
        actor_role: signerRole,
        to_role: forwardToRole,
        to_name: nextName,
        to_email: nextEmail,
        note,
      },
    });

    const events = await repo.listEvents(doc.id);
    return Response.json({
      status: 'pending_cosign',
      forwardedToRole: forwardToRole,
      forwardedToName: nextName,
      finalSha256: finalSha,
      document: toPublicDocument(updatedDoc, true, events),
    });
  }

  // Final lock & completion
  const stampConfig: StampConfig = {
    ...doc.stamp_config,
    page: pageIndex,
    x: Number(stamp.x.toFixed(2)),
    y: Number(stamp.y.toFixed(2)),
    scale: widthFrac,
    cx,
    cy,
    decision,
    note,
    seal_method: appliedSeal,
    signatures: allSignatures,
  };
  const completedAt = new Date().toISOString();
  const nextStatus = decision === 'rejected' ? 'rejected' : 'completed';
  const updatedDoc = await repo.updateDocument(doc.id, {
    status: nextStatus,
    signer2_name: signerName,
    signer2_email: signerEmail,
    final_pdf_path: finalPath,
    final_sha256: finalSha,
    stamp_config: stampConfig,
    completed_at: completedAt,
  });

  const downloadUrl = `${origin}/api/documents/${token}/file?type=final&download=1`;
  const recipients = [doc.signer1_email, signerEmail, ...allSignatures.map((s) => s.actorEmail)].filter(
    (e): e is string => Boolean(e),
  );
  const mail = recipients.length
    ? await sendMail(
        completedEmail({
          to: Array.from(new Set(recipients)),
          title: doc.title,
          refCode: doc.ref_code,
          decision: DECISION_LABELS[decision],
          sha256: finalSha,
          downloadUrl,
          verifyUrl: `${origin}/verify`,
        }),
      )
    : null;

  await repo.addEvent({
    document_id: doc.id,
    event_type: 'completed',
    actor_email: signerEmail,
    ip_address: ip,
    user_agent: ua,
    metadata: {
      actor_name: signerName,
      actor_role: signerRole,
      final_sha256: finalSha,
      signed_content_sha256: signedContentSha,
      seal_method: appliedSeal,
      total_signatures: allSignatures.length,
      notified: recipients,
      email_delivered: mail?.delivered ?? false,
    },
  });

  const events = await repo.listEvents(doc.id);
  return Response.json({
    status: nextStatus,
    finalSha256: finalSha,
    sealMethod: appliedSeal,
    downloadUrl,
    viewUrl: `/api/documents/${token}/file?type=final`,
    emailDelivered: mail?.delivered ?? false,
    document: toPublicDocument(updatedDoc, true, events),
  });
}
