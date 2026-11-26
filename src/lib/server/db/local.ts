import 'server-only';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuditEvent, DocumentRecord, OtpRecord } from '@/lib/types';
import type { Repo } from './index';

/**
 * Local JSON-file database used automatically when Supabase is not configured.
 * Intended for running SignFlow on your own machine (data lives in ./.data).
 */

interface LocalDb {
  documents: DocumentRecord[];
  audit_events: AuditEvent[];
  otp_codes: OtpRecord[];
}

export const LOCAL_DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(LOCAL_DATA_DIR, 'db.json');

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<LocalDb> {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalDb>;
    return {
      documents: parsed.documents ?? [],
      audit_events: parsed.audit_events ?? [],
      otp_codes: parsed.otp_codes ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { documents: [], audit_events: [], otp_codes: [] };
    throw err;
  }
}

async function save(db: LocalDb): Promise<void> {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, DB_FILE);
}

/** Serialises all access so concurrent requests never clobber the file. */
function tx<T>(fn: (db: LocalDb) => T | Promise<T>, write: boolean): Promise<T> {
  const run = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    if (write) await save(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const localRepo: Repo = {
  createDocument(input) {
    return tx((db) => {
      const doc: DocumentRecord = {
        id: randomUUID(),
        original_pdf_path: null,
        final_pdf_path: null,
        stage1_sha256: null,
        final_sha256: null,
        stamp_config: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        ...input,
      };
      db.documents.push(doc);
      return clone(doc);
    }, true);
  },

  getDocumentByToken(token) {
    return tx((db) => clone(db.documents.find((d) => d.sign_token === token) ?? null), false);
  },

  getDocumentByRef(refCode) {
    return tx((db) => clone(db.documents.find((d) => d.ref_code === refCode) ?? null), false);
  },

  refCodeExists(refCode) {
    return tx((db) => db.documents.some((d) => d.ref_code === refCode), false);
  },

  findDocumentByHash(sha256) {
    return tx((db) => {
      const final = db.documents.find((d) => d.final_sha256 === sha256);
      if (final) return { doc: clone(final), match: 'final' as const };
      const stage1 = db.documents.find((d) => d.stage1_sha256 === sha256);
      if (stage1) return { doc: clone(stage1), match: 'stage1' as const };
      return null;
    }, false);
  },

  updateDocument(id, patch) {
    return tx((db) => {
      const doc = db.documents.find((d) => d.id === id);
      if (!doc) throw new Error(`[local-db] document ${id} not found`);
      Object.assign(doc, patch);
      return clone(doc);
    }, true);
  },

  deleteDocument(id) {
    return tx((db) => {
      db.documents = db.documents.filter((d) => d.id !== id);
      db.audit_events = db.audit_events.filter((e) => e.document_id !== id);
      db.otp_codes = db.otp_codes.filter((o) => o.document_id !== id);
    }, true);
  },

  addEvent(event) {
    return tx((db) => {
      const row: AuditEvent = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...event,
        metadata: event.metadata ?? {},
      };
      db.audit_events.push(row);
      return clone(row);
    }, true);
  },

  listEvents(documentId) {
    return tx(
      (db) =>
        clone(
          db.audit_events
            .filter((e) => e.document_id === documentId)
            .sort((a, b) => a.created_at.localeCompare(b.created_at)),
        ),
      false,
    );
  },

  createOtp(otp) {
    return tx((db) => {
      const row: OtpRecord = {
        id: randomUUID(),
        verified: false,
        attempts: 0,
        created_at: new Date().toISOString(),
        ...otp,
        email: otp.email.toLowerCase(),
      };
      db.otp_codes.push(row);
      return clone(row);
    }, true);
  },

  latestOtp(documentId, email) {
    return tx((db) => {
      const rows = db.otp_codes
        .filter((o) => o.document_id === documentId && o.email === email.toLowerCase())
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return clone(rows[0] ?? null);
    }, false);
  },

  updateOtp(id, patch) {
    return tx((db) => {
      const row = db.otp_codes.find((o) => o.id === id);
      if (row) Object.assign(row, patch);
    }, true);
  },

  ping() {
    return tx((db) => ({ documents: db.documents.length }), false);
  },
};
