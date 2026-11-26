import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { appSecret } from './config';

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(data: string): string {
  return createHmac('sha256', appSecret()).update(data).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function randomRefCode(): string {
  return `SF-${randomInt(100000, 1000000)}`;
}

export function randomOtp(): string {
  return randomInt(0, 1000000).toString().padStart(6, '0');
}

export function hashOtp(documentId: string, email: string, code: string): string {
  return sha256Hex(`${documentId}:${email.toLowerCase()}:${code}:${appSecret()}`);
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/* ── Signing session cookie (issued after OTP verification) ── */

export const SESSION_TTL_SECONDS = 30 * 60;

export function sessionCookieName(documentId: string): string {
  return `sf_sess_${documentId.replace(/-/g, '').slice(0, 12)}`;
}

export function createSessionValue(documentId: string, email: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${documentId}.${exp}`;
  const sig = hmacHex(`${payload}.${email.toLowerCase()}`);
  return `${payload}.${sig}`;
}

export function verifySessionValue(value: string | undefined, documentId: string, email: string): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [docId, expStr, sig] = parts;
  if (docId !== documentId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmacHex(`${docId}.${expStr}.${email.toLowerCase()}`);
  return safeEqualHex(sig, expected);
}
