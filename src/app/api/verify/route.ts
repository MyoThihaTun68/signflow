import { getRepo } from '@/lib/server/db';
import { toPublicEvents } from '@/lib/server/documents';
import { jsonError } from '@/lib/server/http';
import type { VerifyResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEX64 = /^[a-f0-9]{64}$/;
const REF = /^SF-\d{6}$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sha256?: unknown; refCode?: unknown };
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase().trim() : '';
  const refCode = typeof body.refCode === 'string' && REF.test(body.refCode) ? body.refCode : null;
  if (!HEX64.test(sha256)) return jsonError('Provide a valid SHA-256 hex digest.');

  const repo = getRepo();
  const match = await repo.findDocumentByHash(sha256);

  let result: VerifyResult;
  if (match) {
    const { doc } = match;
    result = {
      status: 'verified',
      stage: match.match === 'final' ? 'final' : 'original',
      refCode: doc.ref_code,
      title: doc.title,
      documentStatus: doc.status,
      signer1Name: doc.signer1_name || doc.signer1_email,
      signer2Name: doc.signer2_name || doc.signer2_email,
      createdAt: doc.created_at,
      completedAt: doc.completed_at,
      sha256,
      events: toPublicEvents(await repo.listEvents(doc.id)),
    };
  } else if (refCode && (await repo.getDocumentByRef(refCode))) {
    const doc = (await repo.getDocumentByRef(refCode))!;
    result = { status: 'tampered', refCode: doc.ref_code, title: doc.title, sha256 };
  } else {
    result = { status: 'unregistered', sha256 };
  }

  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
