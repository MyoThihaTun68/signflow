import { getRepo } from '@/lib/server/db';
import { findByToken } from '@/lib/server/documents';
import {
  SESSION_TTL_SECONDS,
  createSessionValue,
  hashOtp,
  safeEqualHex,
  sessionCookieName,
} from '@/lib/server/crypto';
import { clientIp, jsonError, userAgent } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = 5;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  if (doc.status !== 'pending_cosign') return jsonError('This document is no longer awaiting a signature.', 409);
  if (!doc.signer2_email) return jsonError('No co-signer email is registered.', 409);

  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  if (code.length !== 6) return jsonError('Enter the 6-digit code.');

  const repo = getRepo();
  const otp = await repo.latestOtp(doc.id, doc.signer2_email);
  if (!otp || otp.verified) return jsonError('No active code. Request a new verification code.', 410);
  if (new Date(otp.expires_at).getTime() < Date.now()) return jsonError('This code has expired. Request a new one.', 410);
  if (otp.attempts >= MAX_ATTEMPTS) return jsonError('Too many incorrect attempts. Request a new code.', 429);

  const ok = safeEqualHex(hashOtp(doc.id, doc.signer2_email, code), otp.code_hash);
  if (!ok) {
    await repo.updateOtp(otp.id, { attempts: otp.attempts + 1 });
    const left = MAX_ATTEMPTS - otp.attempts - 1;
    return jsonError(left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many incorrect attempts. Request a new code.', 401);
  }

  await repo.updateOtp(otp.id, { verified: true });
  await repo.addEvent({
    document_id: doc.id,
    event_type: 'otp_verified',
    actor_email: doc.signer2_email,
    ip_address: clientIp(req),
    user_agent: userAgent(req),
    metadata: { method: 'email_otp', otp_id: otp.id },
  });

  const isHttps = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  const cookie = [
    `${sessionCookieName(doc.id)}=${encodeURIComponent(createSessionValue(doc.id, doc.signer2_email))}`,
    'Path=/api/documents',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    isHttps ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

  return Response.json({ verified: true }, { headers: { 'Set-Cookie': cookie } });
}
