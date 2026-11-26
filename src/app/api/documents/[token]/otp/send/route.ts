import { getRepo } from '@/lib/server/db';
import { findByToken } from '@/lib/server/documents';
import { hashOtp, randomOtp } from '@/lib/server/crypto';
import { jsonError, maskEmail } from '@/lib/server/http';
import { otpEmail, sendMail } from '@/lib/server/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESEND_COOLDOWN_MS = 45_000;
const OTP_TTL_MS = 10 * 60_000;

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  if (doc.status !== 'pending_cosign') return jsonError('This document is no longer awaiting a signature.', 409);
  if (!doc.signer2_email) return jsonError('No co-signer email is registered for this document.', 409);

  const repo = getRepo();
  const latest = await repo.latestOtp(doc.id, doc.signer2_email);
  if (latest && !latest.verified) {
    const wait = new Date(latest.created_at).getTime() + RESEND_COOLDOWN_MS - Date.now();
    if (wait > 0) return jsonError(`Please wait ${Math.ceil(wait / 1000)}s before requesting another code.`, 429);
  }

  const code = randomOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await repo.createOtp({
    document_id: doc.id,
    email: doc.signer2_email.toLowerCase(),
    code_hash: hashOtp(doc.id, doc.signer2_email, code),
    expires_at: expiresAt,
  });

  const mail = await sendMail(otpEmail({ to: doc.signer2_email, code, title: doc.title, refCode: doc.ref_code }));
  if (!mail.delivered && mail.transport !== 'console') {
    return jsonError('The verification email could not be sent. Please try again shortly.', 502);
  }
  const isVercelProd = process.env.VERCEL_ENV === 'production';
  if (!mail.delivered && isVercelProd) {
    return jsonError('Email delivery is not configured on this server.', 503);
  }

  return Response.json({
    sent: true,
    maskedEmail: maskEmail(doc.signer2_email),
    expiresAt,
    // Exposed when running in console-mail fallback outside Vercel production.
    devCode: !mail.delivered && !isVercelProd ? code : undefined,
  });
}
