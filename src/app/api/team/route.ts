import { isSupabaseConfigured } from '@/lib/server/config';
import { getRepo } from '@/lib/server/db';
import { toPublicEvents } from '@/lib/server/documents';
import { baseUrl, cleanText, isValidEmail, jsonError } from '@/lib/server/http';
import { sendMail, teamInviteEmail } from '@/lib/server/mailer';
import { supabaseAdmin } from '@/lib/server/supabase';
import {
  createInviteToken,
  isMemberOwner,
  loadStoredRoster,
  loadTeamRoster,
  readAuthSession,
  removeTeamMember,
  updateTeamMember,
  upsertTeamMember,
} from '@/lib/server/team';
import { normalizeRole, roleLabel, type OrgRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Returns the team roster, all documents with their signature chains, and recent org activity. */
export async function GET(req: Request) {
  if (!readAuthSession(req)) return jsonError('Sign in required.', 401);
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

/** Creates/updates/removes a team member by email & role, and optionally sends an email invitation. */
export async function POST(req: Request) {
  const sessionUser = readAuthSession(req);
  if (!sessionUser) return jsonError('Sign in required.', 401);
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
    const stored = await loadStoredRoster();
    if (!isMemberOwner(stored, sessionUser.email)) {
      return jsonError('Only the workspace owner can remove team members.', 403);
    }
    try {
      const roster = await removeTeamMember(body.id);
      return Response.json({ roster });
    } catch (err) {
      if (err instanceof Error && err.message === 'CANNOT_REMOVE_OWNER') {
        return jsonError('Cannot remove the workspace owner.', 400);
      }
      return jsonError('Could not remove team member.', 500);
    }
  }

  if (body.action === 'edit' && typeof body.id === 'string') {
    const stored = await loadStoredRoster();
    if (!isMemberOwner(stored, sessionUser.email)) {
      return jsonError('Only the workspace owner can edit team members.', 403);
    }
    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 254).toLowerCase();
    const role: OrgRole = normalizeRole(body.role, 'director');
    const department = cleanText(body.department, 100) || roleLabel(role);
    if (!name) return jsonError('Enter the team member name.');
    if (!email || !isValidEmail(email)) return jsonError('Enter a valid email address.');
    try {
      const roster = await updateTeamMember(body.id, { name, email, role, department });
      return Response.json({ roster });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'MEMBER_NOT_FOUND') return jsonError('Team member not found.', 404);
      if (msg === 'EMAIL_IN_USE') return jsonError('Another team member already uses this email.', 409);
      return jsonError('Could not update team member.', 500);
    }
  }

  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 254).toLowerCase();
  const role: OrgRole = normalizeRole(body.role, 'director');
  const department = cleanText(body.department, 100) || roleLabel(role);

  if (!name) return jsonError('Enter the team member name.');
  if (!email || !isValidEmail(email)) return jsonError('Enter a valid email address.');

  const roster = await upsertTeamMember({ name, email, role, department });
  const inviteToken = createInviteToken({ name, email, role, department });
  const inviteUrl = `${baseUrl(req)}/team?invite=${encodeURIComponent(inviteToken)}`;

  let inviteDelivered = false;
  let inviteTransport: 'resend' | 'smtp' | 'supabase' | 'console' = 'console';
  let inviteError: string | null = null;

  if (body.sendInvite !== false) {
    // 1. Try configured SMTP / Resend first using polished responsive SignFlow email template
    const mail = await sendMail(
      teamInviteEmail({
        to: email,
        name,
        roleLabel: roleLabel(role),
        department,
        inviterName: sessionUser.name,
        inviteUrl,
      }),
    );

    if (mail.delivered) {
      inviteDelivered = true;
      inviteTransport = mail.transport;
    } else if (isSupabaseConfigured()) {
      // 2. Fallback to Supabase Auth's built-in email invite service (`inviteUserByEmail`)
      try {
        const sb = supabaseAdmin();
        const { error: invErr } = await sb.auth.admin.inviteUserByEmail(email, {
          redirectTo: inviteUrl,
          data: {
            name,
            role,
            role_label: roleLabel(role),
            department,
            inviter_name: sessionUser.name,
          },
        });
        if (!invErr) {
          inviteDelivered = true;
          inviteTransport = 'supabase';
        } else {
          // If the user was already invited in Supabase Auth, send a magic-link email instead
          const alreadyExists = /already|registered|exists/i.test(invErr.message);
          if (alreadyExists) {
            const { error: otpErr } = await sb.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: inviteUrl, shouldCreateUser: false },
            });
            if (!otpErr) {
              inviteDelivered = true;
              inviteTransport = 'supabase';
            } else {
              inviteError = otpErr.message;
            }
          } else {
            inviteError = invErr.message;
          }
        }
      } catch (err) {
        inviteError = err instanceof Error ? err.message : String(err);
      }
    } else {
      inviteError = mail.error ?? null;
    }
  }

  return Response.json({ roster, inviteDelivered, inviteTransport, inviteError, inviteUrl });
}
