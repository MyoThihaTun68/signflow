import { getRepo } from '@/lib/server/db';
import { toPublicEvents } from '@/lib/server/documents';
import { baseUrl, cleanText, isValidEmail, jsonError } from '@/lib/server/http';
import { escapeHtml, sendMail } from '@/lib/server/mailer';
import { createInviteToken, loadTeamRoster, removeTeamMember, upsertTeamMember } from '@/lib/server/team';
import { ORG_ROLE_LABELS, type OrgRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: OrgRole[] = ['hr', 'director', 'boss', 'manager', 'finance', 'external'];

/** Returns the team roster, all documents with their signature chains, and recent org activity. */
export async function GET() {
  const repo = getRepo();
  const [roster, docs, recentEvents] = await Promise.all([
    loadTeamRoster(),
    repo.listDocuments(60),
    repo.listRecentEvents(80),
  ]);

  const docMap = new Map(docs.map((d) => [d.id, d]));

  const documents = docs.map((d) => ({
    id: d.id,
    refCode: d.ref_code,
    title: d.title,
    status: d.status,
    signToken: d.sign_token,
    signer1Name: d.signer1_name,
    signer1Email: d.signer1_email,
    signer2Name: d.signer2_name,
    signer2Email: d.signer2_email,
    senderRole: d.stamp_config?.sender_role || 'hr',
    assignedRole: d.stamp_config?.assigned_role || 'director',
    requireOtp: Boolean(d.stamp_config?.require_otp),
    decision: d.stamp_config?.decision ?? null,
    signatures: d.stamp_config?.signatures ?? [],
    stage1Sha256: d.stage1_sha256,
    finalSha256: d.final_sha256,
    createdAt: d.created_at,
    completedAt: d.completed_at,
  }));

  const activity = toPublicEvents(recentEvents).map((ev, idx) => {
    const raw = recentEvents[idx];
    const d = docMap.get(raw.document_id);
    return {
      ...ev,
      refCode: d?.ref_code ?? 'SF-??????',
      documentTitle: d?.title ?? 'Document',
      signToken: d?.sign_token ?? null,
    };
  });

  return Response.json(
    {
      roster,
      documents,
      activity,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Creates/updates a team member by email & role, and optionally sends an email invitation. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    id?: unknown;
    name?: unknown;
    email?: unknown;
    role?: unknown;
    department?: unknown;
    sendInvite?: unknown;
  };

  if (body.action === 'remove' && typeof body.id === 'string') {
    const roster = await removeTeamMember(body.id);
    return Response.json({ roster });
  }

  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 254).toLowerCase();
  const roleRaw = cleanText(body.role, 32) as OrgRole;
  const role: OrgRole = ROLES.includes(roleRaw) ? roleRaw : 'director';
  const department = cleanText(body.department, 100) || ORG_ROLE_LABELS[role];

  if (!name) return jsonError('Enter the team member name.');
  if (!email || !isValidEmail(email)) return jsonError('Enter a valid email address.');

  const roster = await upsertTeamMember({ name, email, role, department });
  const inviteToken = createInviteToken({ name, email, role, department });
  const inviteUrl = `${baseUrl(req)}/team?invite=${encodeURIComponent(inviteToken)}`;

  let inviteDelivered = false;
  if (body.sendInvite !== false) {
    const mail = await sendMail({
      to: email,
      subject: `You're invited to SignFlow Team Hub as ${ORG_ROLE_LABELS[role]}`,
      text: `Hello ${name},\n\nYou have been invited to the SignFlow Organization Hub as ${ORG_ROLE_LABELS[role]} (${department}).\n\nClick your personal invite link to activate your account & set your password:\n${inviteUrl}\n\nNext time, you can simply sign in with your email (${email}).`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:16px">
        <h2 style="margin:0 0 12px;color:#007aff">SignFlow Team Hub Invitation</h2>
        <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
        <p>You have been invited to your organization's <strong>SignFlow Team Hub</strong> with the role <strong>${escapeHtml(ORG_ROLE_LABELS[role])}</strong> (${escapeHtml(department)}).</p>
        <p style="margin:22px 0"><a href="${escapeHtml(inviteUrl)}" style="background:#007aff;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Accept Invite &amp; Create Account</a></p>
        <p style="font-size:12px;color:#6e6e73">Invite link: ${escapeHtml(inviteUrl)}</p>
      </div>`,
    });
    inviteDelivered = mail.delivered;
  }

  return Response.json({ roster, inviteDelivered, inviteUrl });
}
