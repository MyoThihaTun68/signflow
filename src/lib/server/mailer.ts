import 'server-only';
import { env, mailTransport } from './config';

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  delivered: boolean;
  transport: 'resend' | 'smtp' | 'console';
  error?: string;
}

type Transporter = { sendMail(opts: Record<string, unknown>): Promise<unknown> };
let smtp: Transporter | null = null;

async function getSmtp(): Promise<Transporter> {
  if (!smtp) {
    const nodemailer = await import('nodemailer');
    smtp = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return smtp;
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const transport = mailTransport();
  const to = Array.isArray(msg.to) ? msg.to : [msg.to];
  try {
    if (transport === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.fromEmail, to, subject: msg.subject, html: msg.html, text: msg.text }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      return { delivered: true, transport };
    }
    if (transport === 'smtp') {
      const t = await getSmtp();
      await t.sendMail({ from: env.fromEmail, to: to.join(', '), subject: msg.subject, html: msg.html, text: msg.text });
      return { delivered: true, transport };
    }
    console.info(
      `\n──────── [SignFlow email · console transport] ────────\nTo: ${to.join(', ')}\nSubject: ${msg.subject}\n\n${msg.text}\n──────────────────────────────────────────────────────\n`,
    );
    return { delivered: false, transport };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[signflow] email delivery failed:', error);
    return { delivered: false, transport, error };
  }
}

/* ── Templates ─────────────────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e5e9f2;border-radius:14px;overflow:hidden">
<tr><td style="padding:20px 28px;border-bottom:1px solid #eef1f6;font-weight:700;font-size:18px;color:#2563eb">SignFlow</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 28px;background:#fafbfd;color:#64748b;font-size:12px">This message was sent by SignFlow. If you were not expecting it, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">Or open: ${escapeHtml(href)}</p>`;
}

export function signRequestEmail(p: {
  to: string;
  signer2Name: string | null;
  signer1Name: string | null;
  signer1Email: string | null;
  title: string;
  refCode: string;
  url: string;
}): MailMessage {
  const from = p.signer1Name || p.signer1Email || 'A SignFlow user';
  const greet = p.signer2Name ? `Hello ${p.signer2Name},` : 'Hello,';
  return {
    to: p.to,
    subject: `Signature requested: ${p.title} (${p.refCode})`,
    text: `${greet}\n\n${from} has asked you to review and co-sign "${p.title}" (Ref ${p.refCode}).\n\nOpen the secure signing link:\n${p.url}\n\nYou will be asked to verify your email with a 6-digit code before signing.`,
    html: layout(
      'You have a document to review & co-sign',
      `<p>${escapeHtml(greet)}</p>
<p><strong>${escapeHtml(from)}</strong> has asked you to review and co-sign <strong>${escapeHtml(p.title)}</strong>.</p>
<p style="color:#64748b;font-size:14px">Reference: <code>${escapeHtml(p.refCode)}</code></p>
${button(p.url, 'Review & Co-Sign')}
<p style="font-size:13px;color:#64748b">For your security you will verify your email address with a 6-digit code before signing.</p>`,
    ),
  };
}

export function otpEmail(p: { to: string; code: string; title: string; refCode: string }): MailMessage {
  return {
    to: p.to,
    subject: `${p.code} is your SignFlow verification code`,
    text: `Your SignFlow verification code for "${p.title}" (${p.refCode}) is: ${p.code}\n\nIt expires in 10 minutes. Never share this code.`,
    html: layout(
      'Your verification code',
      `<p>Use this code to verify your identity for <strong>${escapeHtml(p.title)}</strong> (${escapeHtml(p.refCode)}).</p>
<p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:20px 0;font-family:ui-monospace,Menlo,monospace">${escapeHtml(p.code)}</p>
<p style="font-size:13px;color:#64748b">The code expires in 10 minutes. Never share it with anyone.</p>`,
    ),
  };
}

export function teamInviteEmail(p: {
  to: string;
  name: string;
  roleLabel: string;
  department: string;
  inviterName: string;
  inviteUrl: string;
}): MailMessage {
  const text = [
    `Hello ${p.name},`,
    ``,
    `${p.inviterName} has invited you to join SignFlow Team Hub.`,
    ``,
    `Account Details:`,
    `  • Role: ${p.roleLabel}`,
    `  • Department: ${p.department}`,
    `  • Email: ${p.to}`,
    ``,
    `Activate your account & set your password:`,
    p.inviteUrl,
    ``,
    `This invitation link is valid for 7 days. After setup, sign in anytime with ${p.to}.`,
  ].join('\n');

  const body = `
<p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hello <strong>${escapeHtml(p.name)}</strong>,</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#334155">
  <strong>${escapeHtml(p.inviterName)}</strong> has invited you to join your organization's <strong>SignFlow Team Hub</strong> to review, co-sign, and verify documents.
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 20px">
  <tr>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;width:120px">Assigned Role</td>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(p.roleLabel)}</td>
  </tr>
  <tr>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">Department</td>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a">${escapeHtml(p.department)}</td>
  </tr>
  <tr>
    <td style="padding:12px 16px;font-size:13px;color:#64748b">Sign-In Email</td>
    <td style="padding:12px 16px;font-size:14px;color:#0f172a">${escapeHtml(p.to)}</td>
  </tr>
</table>
${button(p.inviteUrl, 'Accept Invite & Set Password')}
<p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.5">
  This invite link expires in 7 days. Once your password is set, you can sign in anytime with <strong>${escapeHtml(p.to)}</strong>.
</p>`;

  return {
    to: p.to,
    subject: `${p.inviterName} invited you to SignFlow (${p.roleLabel})`,
    text,
    html: layout('You’re invited to SignFlow Team Hub', body),
  };
}

export function completedEmail(p: {
  to: string[];
  title: string;
  refCode: string;
  decision: string;
  sha256: string;
  downloadUrl: string;
  verifyUrl: string;
}): MailMessage {
  return {
    to: p.to,
    subject: `Completed: ${p.title} (${p.refCode}) — ${p.decision}`,
    text: `"${p.title}" (${p.refCode}) has been sealed.\nDecision: ${p.decision}\nSHA-256: ${p.sha256}\n\nDownload the sealed PDF:\n${p.downloadUrl}\n\nVerify authenticity anytime:\n${p.verifyUrl}`,
    html: layout(
      'Your document has been sealed',
      `<p><strong>${escapeHtml(p.title)}</strong> (${escapeHtml(p.refCode)}) was co-signed and sealed.</p>
<p>Decision: <strong>${escapeHtml(p.decision)}</strong></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">SHA-256: <code>${escapeHtml(p.sha256)}</code></p>
${button(p.downloadUrl, 'Download sealed PDF')}
<p style="font-size:13px;color:#64748b">Anyone can check this file at <a href="${escapeHtml(p.verifyUrl)}">${escapeHtml(p.verifyUrl)}</a>.</p>`,
    ),
  };
}
