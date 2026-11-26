import { findByToken } from '@/lib/server/documents';
import { jsonError } from '@/lib/server/http';
import { getObject } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams the latest (stamped/final if available, otherwise original) or explicitly requested PDF. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const requested = url.searchParams.get('type');
  const download = url.searchParams.get('download') === '1';

  const doc = await findByToken(token);
  if (!doc) return jsonError('Not found', 404);

  // If a multi-step document already has a stamped PDF in `final_pdf_path`, preview that so
  // subsequent signers (e.g. Boss after Director) see the previous signature stamps on the page!
  const objectPath =
    requested === 'original'
      ? doc.original_pdf_path
      : doc.final_pdf_path || doc.original_pdf_path;

  if (!objectPath) return jsonError('File missing.', 404);

  const bytes = await getObject(objectPath);
  if (!bytes) return jsonError('File could not be retrieved from storage.', 404);

  const name = `${doc.ref_code}-${doc.final_pdf_path ? 'signed' : 'original'}.pdf`;
  return new Response(new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
