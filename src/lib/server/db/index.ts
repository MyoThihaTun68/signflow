import 'server-only';
import type { AuditEvent, AuditEventType, DocumentRecord, OtpRecord } from '@/lib/types';
import { isSupabaseConfigured } from '../config';
import { localRepo } from './local';
import { supabaseRepo } from './supabase';

export interface NewDocument {
  ref_code: string;
  title: string;
  status: DocumentRecord['status'];
  signer1_name: string | null;
  signer1_email: string | null;
  signer2_name: string | null;
  signer2_email: string | null;
  sign_token: string;
}

export interface NewAuditEvent {
  document_id: string;
  event_type: AuditEventType;
  actor_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata?: Record<string, unknown>;
}

export interface NewOtp {
  document_id: string;
  email: string;
  code_hash: string;
  expires_at: string;
}

export type DocumentPatch = Partial<Omit<DocumentRecord, 'id' | 'created_at' | 'sign_token' | 'ref_code'>>;

export interface Repo {
  createDocument(input: NewDocument): Promise<DocumentRecord>;
  getDocumentByToken(token: string): Promise<DocumentRecord | null>;
  getDocumentByRef(refCode: string): Promise<DocumentRecord | null>;
  refCodeExists(refCode: string): Promise<boolean>;
  findDocumentByHash(sha256: string): Promise<{ doc: DocumentRecord; match: 'stage1' | 'final' } | null>;
  updateDocument(id: string, patch: DocumentPatch): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<void>;
  addEvent(event: NewAuditEvent): Promise<AuditEvent>;
  listEvents(documentId: string): Promise<AuditEvent[]>;
  createOtp(otp: NewOtp): Promise<OtpRecord>;
  latestOtp(documentId: string, email: string): Promise<OtpRecord | null>;
  updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'verified' | 'attempts'>>): Promise<void>;
  listDocuments(limit?: number): Promise<DocumentRecord[]>;
  listRecentEvents(limit?: number): Promise<AuditEvent[]>;
  ping(): Promise<{ documents: number }>;
}

const PGRST_MISSING_TABLE = 'PGRST205';

function isMissingSchemaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(PGRST_MISSING_TABLE) || msg.includes('Could not find the table');
}

let loggedSchemaWarn = false;
function withLocalFallback(primary: Repo, fallback: Repo): Repo {
  const wrap = <K extends keyof Repo>(key: K): Repo[K] => {
    const fn = primary[key] as (...args: unknown[]) => Promise<unknown>;
    const fb = fallback[key] as (...args: unknown[]) => Promise<unknown>;
    return (async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (isMissingSchemaError(err)) {
          if (!loggedSchemaWarn) {
            loggedSchemaWarn = true;
            console.warn(
              '[signflow] Supabase tables not created yet (PGRST205). Run supabase/schema.sql in Supabase SQL Editor. Falling back to local .data/db.json until tables exist.',
            );
          }
          return await fb(...args);
        }
        throw err;
      }
    }) as Repo[K];
  };
  return {
    createDocument: wrap('createDocument'),
    getDocumentByToken: wrap('getDocumentByToken'),
    getDocumentByRef: wrap('getDocumentByRef'),
    refCodeExists: wrap('refCodeExists'),
    findDocumentByHash: wrap('findDocumentByHash'),
    updateDocument: wrap('updateDocument'),
    deleteDocument: wrap('deleteDocument'),
    addEvent: wrap('addEvent'),
    listEvents: wrap('listEvents'),
    createOtp: wrap('createOtp'),
    latestOtp: wrap('latestOtp'),
    updateOtp: wrap('updateOtp'),
    listDocuments: wrap('listDocuments'),
    listRecentEvents: wrap('listRecentEvents'),
    ping: wrap('ping'),
  };
}

const resilientSupabaseRepo = withLocalFallback(supabaseRepo, localRepo);

export function getRepo(): Repo {
  return isSupabaseConfigured() ? resilientSupabaseRepo : localRepo;
}
