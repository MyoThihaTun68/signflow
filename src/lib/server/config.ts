import 'server-only';

const DEV_SECRET = 'signflow-local-development-secret-change-me';

export const env = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  bucket: process.env.SUPABASE_BUCKET || 'documents',
  appUrl: (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, ''),
  resendKey: process.env.RESEND_API_KEY || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  fromEmail: process.env.FROM_EMAIL || 'SignFlow <no-reply@signflow.local>',
  p12Base64: process.env.SIGNING_P12_BASE64 || '',
  p12Passphrase: process.env.SIGNING_P12_PASSPHRASE || '',
  signingReason: process.env.SIGNING_REASON || 'Document sealed by SignFlow',
  signingLocation: process.env.SIGNING_LOCATION || 'SignFlow Cloud',
  signingContact: process.env.SIGNING_CONTACT || '',
  cronSecret: process.env.CRON_SECRET || '',
  isProduction: process.env.NODE_ENV === 'production',
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey);
}

export function mailTransport(): 'resend' | 'smtp' | 'console' {
  if (env.resendKey) return 'resend';
  if (env.smtpHost) return 'smtp';
  return 'console';
}

let warned = false;
export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 16) return s;
  if (!warned) {
    warned = true;
    console.warn('[signflow] APP_SECRET is not set (or < 16 chars). Using an insecure development secret.');
  }
  return DEV_SECRET;
}
