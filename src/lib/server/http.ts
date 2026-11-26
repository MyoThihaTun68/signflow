import 'server-only';
import { env } from './config';

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || '127.0.0.1';
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') || 'unknown').slice(0, 400);
}

export function baseUrl(req: Request): string {
  if (env.appUrl) return env.appUrl;
  const origin = req.headers.get('origin');
  if (origin && /^https?:\/\/[^/\s]+$/i.test(origin)) {
    return origin.replace(/\/+$/, '');
  }
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore invalid referer
    }
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const proto =
    req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
