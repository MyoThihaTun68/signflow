import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env, isSupabaseConfigured } from './config';
import { LOCAL_DATA_DIR } from './db/local';
import { supabaseAdmin } from './supabase';

const LOCAL_STORAGE_DIR = path.join(LOCAL_DATA_DIR, 'storage');

function localPath(objectPath: string): string {
  const safe = path.normalize(objectPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(LOCAL_STORAGE_DIR, safe);
  if (!full.startsWith(LOCAL_STORAGE_DIR)) throw new Error('Invalid storage path');
  return full;
}

export async function putObject(objectPath: string, bytes: Uint8Array, contentType = 'application/pdf'): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await supabaseAdmin()
      .storage.from(env.bucket)
      .upload(objectPath, Buffer.from(bytes), { contentType, upsert: true, cacheControl: '3600' });
    if (error) throw new Error(`[storage] upload failed: ${error.message}`);
    return;
  }
  const full = localPath(objectPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}

export async function getObject(objectPath: string): Promise<Uint8Array | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseAdmin().storage.from(env.bucket).download(objectPath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  try {
    return new Uint8Array(await fs.readFile(localPath(objectPath)));
  } catch {
    return null;
  }
}

export async function removeObject(objectPath: string): Promise<void> {
  if (isSupabaseConfigured()) {
    await supabaseAdmin().storage.from(env.bucket).remove([objectPath]);
    return;
  }
  await fs.rm(localPath(objectPath), { force: true });
}

export async function pingStorage(): Promise<{ ok: boolean; detail: string }> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseAdmin().storage.from(env.bucket).list('', { limit: 1 });
    return error ? { ok: false, detail: error.message } : { ok: true, detail: `listed ${data?.length ?? 0}` };
  }
  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
  return { ok: true, detail: 'local filesystem' };
}
