import { env, isSupabaseConfigured } from '@/lib/server/config';
import { getRepo } from '@/lib/server/db';
import { pingStorage } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by Vercel Cron every 3 days (see vercel.json) so the Supabase
 * free-tier project never hits the 7-day inactivity pause.
 */
export async function GET(req: Request) {
  if (env.cronSecret && req.headers.get('authorization') !== `Bearer ${env.cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const [db, storage] = await Promise.all([getRepo().ping(), pingStorage()]);
    return Response.json({
      ok: true,
      backend: isSupabaseConfigured() ? 'supabase' : 'local',
      documents: db.documents,
      storage,
      ms: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
