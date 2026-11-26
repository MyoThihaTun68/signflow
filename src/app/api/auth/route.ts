import { cleanText, isValidEmail, jsonError } from '@/lib/server/http';
import {
  USER_COOKIE_NAME,
  USER_SESSION_TTL,
  authenticateMember,
  createAuthCookieValue,
  loadTeamRoster,
  readAuthSession,
  registerOrActivateMember,
  verifyInviteToken,
} from '@/lib/server/team';
import { ORG_ROLE_LABELS, type OrgRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: OrgRole[] = ['hr', 'director', 'boss', 'manager', 'finance', 'external'];

function makeCookieHeader(req: Request, value: string, maxAge: number): string {
  const isHttps = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return [
    `${USER_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    isHttps ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** GET /api/auth?invite=<token> -> returns signed-in user, team roster, and decoded invite if provided. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const inviteToken = url.searchParams.get('invite');
  const invite = inviteToken ? verifyInviteToken(inviteToken) : null;
  const sessionUser = readAuthSession(req);
  const roster = await loadTeamRoster();

  // Refresh session user against latest roster entry if present
  const user = sessionUser
    ? roster.find((m) => m.email.toLowerCase() === sessionUser.email.toLowerCase()) ?? sessionUser
    : null;

  return Response.json(
    {
      user,
      roster,
      invite,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** POST /api/auth -> action: 'register' | 'login' | 'logout' */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
    department?: unknown;
    inviteToken?: unknown;
  };

  const action = cleanText(body.action, 32);

  if (action === 'logout') {
    return Response.json(
      { user: null },
      { headers: { 'Set-Cookie': makeCookieHeader(req, '', 0) } },
    );
  }

  const email = cleanText(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !isValidEmail(email)) return jsonError('Enter a valid email address.');
  if (password.length < 4) return jsonError('Password must be at least 4 characters.');

  if (action === 'login') {
    try {
      const member = await authenticateMember(email, password);
      const cookie = makeCookieHeader(req, createAuthCookieValue(member), USER_SESSION_TTL);
      const roster = await loadTeamRoster();
      return Response.json({ user: member, roster }, { headers: { 'Set-Cookie': cookie } });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'NOT_FOUND') {
        return jsonError('No account found for this email. Click "First-Time Create Account" to register.', 404);
      }
      if (code === 'INVITED_NEEDS_SETUP') {
        return jsonError(
          'You were invited to the team! Switch to "First-Time Create Account" to set your password and activate.',
          409,
        );
      }
      return jsonError('Incorrect email or password.', 401);
    }
  }

  // Default: register / activate invited account
  const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken : '';
  const invite = inviteToken ? verifyInviteToken(inviteToken) : null;

  const roleRaw = cleanText(body.role, 32) as OrgRole;
  const role: OrgRole = invite ? invite.role : ROLES.includes(roleRaw) ? roleRaw : 'hr';
  const name = cleanText(body.name, 120) || invite?.name || email.split('@')[0];
  const department = cleanText(body.department, 100) || invite?.department || ORG_ROLE_LABELS[role];

  try {
    const { member, roster } = await registerOrActivateMember({
      name,
      email: invite ? invite.email : email,
      password,
      role,
      department,
      allowOverwritePassword: Boolean(invite),
    });
    const cookie = makeCookieHeader(req, createAuthCookieValue(member), USER_SESSION_TTL);
    return Response.json({ user: member, roster }, { headers: { 'Set-Cookie': cookie } });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'ACCOUNT_EXISTS') {
      return jsonError('An account with this email already exists. Switch to "Sign In" to log in.', 409);
    }
    return jsonError('Could not create account.', 500);
  }
}
