import { getRepo } from '@/lib/server/db';
import { extractComments, findByToken, toPublicEvents } from '@/lib/server/documents';
import { cleanText, clientIp, jsonError, userAgent } from '@/lib/server/http';
import type { OrgRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: OrgRole[] = ['hr', 'director', 'boss', 'manager', 'finance', 'external'];

/** Adds a team chat comment / note to the document's live thread. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = await findByToken(token);
  if (!doc) return jsonError('Document not found.', 404);

  const body = (await req.json().catch(() => ({}))) as {
    authorName?: unknown;
    authorEmail?: unknown;
    authorRole?: unknown;
    message?: unknown;
  };
  const message = cleanText(body.message, 800);
  if (!message) return jsonError('Enter a message.');
  const authorName = cleanText(body.authorName, 120) || 'Team Member';
  const authorEmail = cleanText(body.authorEmail, 254).toLowerCase() || doc.signer2_email || 'team@signflow.org';
  const roleRaw = cleanText(body.authorRole, 32) as OrgRole;
  const authorRole: OrgRole = ROLES.includes(roleRaw) ? roleRaw : 'director';

  const repo = getRepo();
  await repo.addEvent({
    document_id: doc.id,
    event_type: 'viewed',
    actor_email: authorEmail,
    ip_address: clientIp(req),
    user_agent: userAgent(req),
    metadata: {
      kind: 'comment',
      author_name: authorName,
      author_role: authorRole,
      message,
    },
  });

  const events = await repo.listEvents(doc.id);
  return Response.json({
    comments: extractComments(events),
    events: toPublicEvents(events),
  });
}
