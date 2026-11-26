import { PDFDocument } from 'pdf-lib';
import { getRepo } from '@/lib/server/db';
import { putObject, removeObject } from '@/lib/server/storage';
import { randomRefCode, randomToken, sha256Hex } from '@/lib/server/crypto';
import { baseUrl, cleanText, clientIp, isValidEmail, jsonError, userAgent } from '@/lib/server/http';
import { sendMail, signRequestEmail } from '@/lib/server/mailer';
import { readAuthSession } from '@/lib/server/team';
import { normalizeRole, type OrgRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF_BYTES = 4.3 * 1024 * 1024;

export async function POST(req: Request) {
  if (!readAuthSession(req)) return jsonError('Sign in required to create or send documents.', 401);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('Expected multipart/form-data body.');
  }

  const file = form.get('file');
  const title = cleanText(form.get('title'), 160) || 'Untitled document';
  const signer1Name = cleanText(form.get('signer1Name'), 120) || null;
  const signer1Email = cleanText(form.get('signer1Email'), 254).toLowerCase() || null;
  const signer2Name = cleanText(form.get('signer2Name'), 120) || null;
  const signer2Email = cleanText(form.get('signer2Email'), 254).toLowerCase();
  const senderRole: OrgRole = normalizeRole(form.get('senderRole'), 'hr');
  const assignedRole: OrgRole = normalizeRole(form.get('assignedRole'), 'director');
  const requireOtp = form.get('requireOtp') === 'true' || form.get('requireOtp') === '1';

  if (!(file instanceof Blob) || file.size === 0) return jsonError('A PDF file is required.');
  if (file.size > MAX_PDF_BYTES) return jsonError('PDF is larger than 4.3 MB. Reduce pages or zoom and try again.', 413);
  if (!signer2Email || !isValidEmail(signer2Email)) return jsonError('A valid assignee / co-signer email is required.');
  if (signer1Email && !isValidEmail(signer1Email)) return jsonError('Sender email is not valid.');

  const raw = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...raw.slice(0, 5)) !== '%PDF-') return jsonError('Uploaded file is not a PDF.');

  const repo = getRepo();
  const ip = clientIp(req);
  const ua = userAgent(req);

  let refCode = randomRefCode();
  for (let i = 0; i < 8 && (await repo.refCodeExists(refCode)); i++) refCode = randomRefCode();
  const token = randomToken();

  let pdfBytes: Uint8Array;
  let pageCount = 0;
  try {
    const pdf = await PDFDocument.load(raw, { updateMetadata: false });
    pageCount = pdf.getPageCount();
    // Keep the visible PDF page 100% clean — store reference code in PDF metadata only
    pdf.setTitle(title);
    pdf.setSubject(`SignFlow ${refCode}`);
    pdf.setKeywords(['SignFlow', refCode, 'stage1']);
    pdf.setProducer('SignFlow (pdf-lib)');
    pdf.setCreator('SignFlow');
    pdf.setCreationDate(new Date());
    pdf.setModificationDate(new Date());
    pdfBytes = await pdf.save();
  } catch {
    return jsonError('The PDF could not be processed (corrupted or encrypted).');
  }
  const stage1 = sha256Hex(pdfBytes);

  const doc = await repo.createDocument({
    ref_code: refCode,
    title,
    status: 'draft',
    signer1_name: signer1Name,
    signer1_email: signer1Email,
    signer2_name: signer2Name,
    signer2_email: signer2Email,
    sign_token: token,
  });

  const objectPath = `originals/${doc.id}.pdf`;
  try {
    await putObject(objectPath, pdfBytes);
  } catch (err) {
    await repo.deleteDocument(doc.id).catch(() => undefined);
    await removeObject(objectPath).catch(() => undefined);
    console.error(err);
    return jsonError('Failed to store the PDF. Check storage configuration.', 500);
  }

  await repo.updateDocument(doc.id, {
    original_pdf_path: objectPath,
    stage1_sha256: stage1,
    stamp_config: {
      require_otp: requireOtp,
      sender_role: senderRole,
      assigned_role: assignedRole,
      signatures: [],
    },
  });
  await repo.addEvent({
    document_id: doc.id,
    event_type: 'created',
    actor_email: signer1Email,
    ip_address: ip,
    user_agent: ua,
    metadata: {
      title,
      pages: pageCount,
      bytes: pdfBytes.length,
      stage1_sha256: stage1,
      actor_name: signer1Name,
      actor_role: senderRole,
      assigned_role: assignedRole,
      require_otp: requireOtp,
    },
  });

  const signUrl = `${baseUrl(req)}/sign/${token}`;
  const mail = await sendMail(
    signRequestEmail({ to: signer2Email, signer2Name, signer1Name, signer1Email, title, refCode, url: signUrl }),
  );

  await repo.updateDocument(doc.id, { status: 'pending_cosign' });
  await repo.addEvent({
    document_id: doc.id,
    event_type: 'sent',
    actor_email: signer1Email,
    ip_address: ip,
    user_agent: ua,
    metadata: {
      to: signer2Email,
      to_name: signer2Name,
      assigned_role: assignedRole,
      actor_name: signer1Name,
      actor_role: senderRole,
      email_delivered: mail.delivered,
      transport: mail.transport,
      error: mail.error ?? null,
    },
  });

  return Response.json({
    refCode,
    token,
    signUrl,
    sha256: stage1,
    senderRole,
    assignedRole,
    requireOtp,
    emailDelivered: mail.delivered,
    emailTransport: mail.transport,
    emailError: mail.error ?? null,
  });
}
