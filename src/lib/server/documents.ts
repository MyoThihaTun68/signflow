import 'server-only';
import { EVENT_LABELS, type AuditEvent, type DocumentRecord, type PublicAuditEvent, type PublicDocument } from '@/lib/types';
import { getRepo } from './db';
import { getCookie, maskEmail } from './http';
import { sessionCookieName, verifySessionValue } from './crypto';

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export async function findByToken(token: string): Promise<DocumentRecord | null> {
  if (!TOKEN_RE.test(token)) return null;
  return getRepo().getDocumentByToken(token);
}

export function hasValidSession(req: Request, doc: DocumentRecord): boolean {
  if (!doc.signer2_email) return false;
  return verifySessionValue(getCookie(req, sessionCookieName(doc.id)), doc.id, doc.signer2_email);
}

export function toPublicDocument(doc: DocumentRecord, sessionVerified: boolean): PublicDocument {
  return {
    refCode: doc.ref_code,
    title: doc.title,
    status: doc.status,
    signer1Name: doc.signer1_name,
    signer1Email: doc.signer1_email,
    signer2Name: doc.signer2_name,
    signer2EmailMasked: maskEmail(doc.signer2_email),
    createdAt: doc.created_at,
    completedAt: doc.completed_at,
    stage1Sha256: doc.stage1_sha256,
    finalSha256: doc.final_sha256,
    decision: doc.stamp_config?.decision ?? null,
    sessionVerified,
  };
}

export function toPublicEvents(events: AuditEvent[]): PublicAuditEvent[] {
  return events.map((e) => ({
    type: e.event_type,
    label: EVENT_LABELS[e.event_type] ?? e.event_type,
    actorEmail: e.actor_email,
    ipAddress: e.ip_address,
    userAgent: e.user_agent,
    createdAt: e.created_at,
  }));
}
