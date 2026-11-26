import { getRepo } from '@/lib/server/db';
import { findByToken, hasValidSession, toPublicDocument } from '@/lib/server/documents';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const doc = await findByToken(token);
  if (!doc) return jsonError('This signing link is invalid or has been removed.', 404);
  const events = await getRepo().listEvents(doc.id);
  return Response.json(toPublicDocument(doc, hasValidSession(req, doc), events), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
