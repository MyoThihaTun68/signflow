import { findByToken } from '@/lib/server/documents';
import { jsonError } from '@/lib/server/http';
import { getObject } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams the original or final PDF. ?type=original|final&download=1 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const type = url.searchParams.get('type') === 'final' ? 'final' : 'original';
  const download = url.searchParams.get('download') === '1';

  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);
  const objectPath = type === 'final' ? doc.final_pdf_path : doc.original_pdf_path;
  if (!objectPath) return jsonError(type === 'final' ? 'This document has not been sealed yet.' : 'File missing.', 404);

  const bytes = await getObject(objectPath);
  if (!bytes) return jsonError('File could not be retrieved from storage.', 404);

  const name = `${doc.ref_code}-${type === 'final' ? 'sealed' : 'original'}.pdf`;
  return new Response(new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
