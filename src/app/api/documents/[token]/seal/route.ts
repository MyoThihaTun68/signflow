import { PDFDocument, rgb } from 'pdf-lib';
import { getRepo } from '@/lib/server/db';
import { findByToken, hasValidSession } from '@/lib/server/documents';
import { hmacHex, sha256Hex } from '@/lib/server/crypto';
import { baseUrl, cleanText, clientIp, jsonError, userAgent } from '@/lib/server/http';
import { completedEmail, sendMail } from '@/lib/server/mailer';
import { getObject, putObject } from '@/lib/server/storage';
import { isP12Configured, signWithP12 } from '@/lib/server/p12';
import { formatUtc } from '@/lib/pdf/certificate';
import { DECISION_COLORS, dataUrlToBytes, drawStamp } from '@/lib/pdf/stamp';
import { DECISION_LABELS, type Decision, type StampConfig } from '@/lib/types';

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
}

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const repo = getRepo();
  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  if (doc.status !== 'pending_cosign') return jsonError('This document has already been sealed.', 409);
  if (!hasValidSession(req, doc)) return jsonError('Email verification required (or expired). Verify the OTP again.', 401);
  if (!doc.original_pdf_path || !doc.stage1_sha256) return jsonError('Original PDF is missing.', 500);

  const body = (await req.json().catch(() => ({}))) as SealBody;
  const decision = (['approved', 'approved_with_notes', 'rejected'] as const).find((d) => d === body.decision) as
    | Decision
    | undefined;
  const page = num(body.page, 0, 10_000);
  const cx = num(body.cx, 0, 1);
  const cy = num(body.cy, 0, 1);
  const widthFrac = num(body.widthFrac, 0.04, 0.9);
  const note = cleanText(body.note, 600) || null;
  const signerName = cleanText(body.signerName, 120) || doc.signer2_name || doc.signer2_email || 'Signer 2';
  const signature = typeof body.signature === 'string' ? body.signature : '';

  if (!decision) return jsonError('Choose a decision.');
  if (decision === 'approved_with_notes' && !note) return jsonError('Add a note for "Approved w/ Notes".');
  if (page === null || cx === null || cy === null || widthFrac === null) return jsonError('Invalid stamp position.');
  if (!signature.startsWith('data:image/png;base64,') || signature.length > 2_500_000)
    return jsonError('Signature must be a PNG image under ~1.8 MB.');

  const original = await getObject(doc.original_pdf_path);
  if (!original) return jsonError('Original PDF could not be loaded from storage.', 500);
  if (sha256Hex(original) !== doc.stage1_sha256)
    return jsonError('Integrity check failed: stored original does not match its registered fingerprint.', 500);

  const ip = clientIp(req);
  const ua = userAgent(req);
  const signedAt = new Date().toISOString();

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(original, { updateMetadata: false });
  } catch {
    return jsonError('Original PDF could not be parsed.', 500);
  }
  const pageIndex = Math.floor(page);
  if (pageIndex >= pdf.getPageCount()) return jsonError('Page out of range.');

  let stamp;
  try {
    stamp = await drawStamp(pdf, pageIndex, dataUrlToBytes(signature), { cx, cy, widthFrac }, [
      { text: DECISION_LABELS[decision].toUpperCase(), size: 9, bold: true, color: DECISION_COLORS[decision] },
      { text: `${signerName} · ${formatUtc(signedAt)}`, size: 7, color: rgb(0.25, 0.29, 0.36) },
      ...(note ? [{ text: `Note: ${note}`, size: 7, color: rgb(0.3, 0.33, 0.4) }] : []),
      { text: `Ref ${doc.ref_code} · OTP verified`, size: 6, color: rgb(0.5, 0.55, 0.62) },
    ]);
  } catch {
    return jsonError('Signature image could not be embedded.', 400);
  }

  await repo.addEvent({
    document_id: doc.id,
    event_type: 'signed',
    actor_email: doc.signer2_email,
    ip_address: ip,
    user_agent: ua,
    metadata: { decision, note, page: pageIndex + 1, signer_name: signerName },
  });

  const signedContent = await pdf.save();
  const signedContentSha = sha256Hex(signedContent);
  const sealMethod = isP12Configured() ? 'p12' : 'hash';
  const sealValue = hmacHex(`${doc.ref_code}|${doc.stage1_sha256}|${signedContentSha}|${decision}`);
  const origin = baseUrl(req);

  // Do NOT append an extra blank Certificate page — keep only the original pages
  // with the transparent signature stamp overlaid so the document background stays 100% intact.
  pdf.setTitle(doc.title);
  pdf.setSubject(`SignFlow ${doc.ref_code}`);
  pdf.setKeywords(['SignFlow', doc.ref_code, 'sealed', `seal:${sealValue.slice(0, 32)}`]);
  pdf.setProducer('SignFlow (pdf-lib)');
  pdf.setModificationDate(new Date());

  const hashSealed = await pdf.save();
  let finalBytes: Uint8Array = hashSealed;
  let appliedSeal: 'p12' | 'hash' = 'hash';
  if (sealMethod === 'p12') {
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

  const stampConfig: StampConfig = {
    page: pageIndex,
    x: Number(stamp.x.toFixed(2)),
    y: Number(stamp.y.toFixed(2)),
    scale: widthFrac,
    cx,
    cy,
    decision,
    note,
    seal_method: appliedSeal,
  };
  const completedAt = new Date().toISOString();
  await repo.updateDocument(doc.id, {
    status: decision === 'rejected' ? 'rejected' : 'completed',
    final_pdf_path: finalPath,
    final_sha256: finalSha,
    stamp_config: stampConfig,
    completed_at: completedAt,
  });

  const downloadUrl = `${origin}/api/documents/${token}/file?type=final&download=1`;
  const recipients = [doc.signer1_email, doc.signer2_email].filter((e): e is string => Boolean(e));
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
    actor_email: doc.signer2_email,
    ip_address: ip,
    user_agent: ua,
    metadata: {
      final_sha256: finalSha,
      signed_content_sha256: signedContentSha,
      seal_method: appliedSeal,
      notified: recipients,
      email_delivered: mail?.delivered ?? false,
    },
  });

  return Response.json({
    status: decision === 'rejected' ? 'rejected' : 'completed',
    finalSha256: finalSha,
    sealMethod: appliedSeal,
    downloadUrl,
    viewUrl: `/api/documents/${token}/file?type=final`,
    emailDelivered: mail?.delivered ?? false,
  });
}
