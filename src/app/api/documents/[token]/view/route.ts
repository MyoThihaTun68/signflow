import { getRepo } from '@/lib/server/db';
import { findByToken } from '@/lib/server/documents';
import { clientIp, jsonError, userAgent } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Logs a `viewed` audit event when the signing page is opened. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  const event = await getRepo().addEvent({
    document_id: doc.id,
    event_type: 'viewed',
    actor_email: doc.signer2_email,
    ip_address: clientIp(req),
    user_agent: userAgent(req),
    metadata: { status_at_view: doc.status, referer: req.headers.get('referer') ?? null },
  });
  return Response.json({ ok: true, at: event.created_at });
}
