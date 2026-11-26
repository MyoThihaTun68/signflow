import 'server-only';
import {
  EVENT_LABELS,
  roleLabel,
  type AuditEvent,
  type DocumentComment,
  type DocumentRecord,
  type OrgRole,
  type PublicAuditEvent,
  type PublicDocument,
} from '@/lib/types';
import { getRepo } from './db';
import { getCookie, maskEmail } from './http';
import { sessionCookieName, verifySessionValue } from './crypto';

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export async function findByToken(token: string): Promise<DocumentRecord | null> {
  if (!TOKEN_RE.test(token)) return null;
  return getRepo().getDocumentByToken(token);
}

export function isOtpRequired(doc: DocumentRecord): boolean {
  return Boolean(doc.stamp_config?.require_otp);
}

export function hasValidSession(req: Request, doc: DocumentRecord): boolean {
  if (!isOtpRequired(doc)) return true;
  if (!doc.signer2_email) return false;
  return verifySessionValue(getCookie(req, sessionCookieName(doc.id)), doc.id, doc.signer2_email);
}

export function extractComments(events: AuditEvent[]): DocumentComment[] {
  const comments: DocumentComment[] = [];
  for (const ev of events) {
    const meta = ev.metadata || {};
    if (meta.kind === 'comment' && typeof meta.message === 'string') {
      comments.push({
        id: ev.id,
        authorName: typeof meta.author_name === 'string' ? meta.author_name : ev.actor_email || 'Team Member',
        authorEmail: ev.actor_email || '',
        authorRole: (meta.author_role as OrgRole) || 'director',
        message: meta.message,
        createdAt: ev.created_at,
      });
    }
  }
  return comments;
}

export function toPublicEvents(events: AuditEvent[]): PublicAuditEvent[] {
  return events.map((e) => {
    const meta = e.metadata || {};
    let label = EVENT_LABELS[e.event_type] ?? e.event_type;
    let detail: string | null = null;
    if (meta.kind === 'comment' && typeof meta.message === 'string') {
      label = 'Commented';
      detail = meta.message;
    } else if (meta.kind === 'forwarded') {
      const toRole = typeof meta.to_role === 'string' ? roleLabel(meta.to_role) : '';
      label = `Forwarded to ${toRole || meta.to_email || 'Next Signer'}`;
      detail = typeof meta.note === 'string' ? meta.note : null;
    } else if (e.event_type === 'signed') {
      const roleStr = typeof meta.actor_role === 'string' ? roleLabel(meta.actor_role) : '';
      const dec = typeof meta.decision === 'string' ? meta.decision.replace(/_/g, ' ').toUpperCase() : 'SIGNED';
      label = roleStr ? `${roleStr} Signed (${dec})` : `Signed (${dec})`;
      detail = typeof meta.note === 'string' ? meta.note : null;
    }
    return {
      type: e.event_type,
      label,
      actorEmail: e.actor_email,
      actorName: typeof meta.actor_name === 'string' ? meta.actor_name : typeof meta.author_name === 'string' ? meta.author_name : null,
      actorRole: (meta.actor_role as OrgRole) || (meta.author_role as OrgRole) || null,
      ipAddress: e.ip_address,
      userAgent: e.user_agent,
      detail,
      createdAt: e.created_at,
    };
  });
}

export function toPublicDocument(doc: DocumentRecord, sessionVerified: boolean, events: AuditEvent[] = []): PublicDocument {
  const cfg = doc.stamp_config || {};
  return {
    refCode: doc.ref_code,
    title: doc.title,
    status: doc.status,
    signer1Name: doc.signer1_name,
    signer1Email: doc.signer1_email,
    signer2Name: doc.signer2_name,
    signer2Email: doc.signer2_email,
    signer2EmailMasked: maskEmail(doc.signer2_email),
    senderRole: cfg.sender_role || 'hr',
    assignedRole: cfg.assigned_role || 'director',
    requireOtp: Boolean(cfg.require_otp),
    createdAt: doc.created_at,
    completedAt: doc.completed_at,
    stage1Sha256: doc.stage1_sha256,
    finalSha256: doc.final_sha256,
    decision: cfg.decision ?? null,
    sessionVerified,
    signatures: cfg.signatures ?? [],
    comments: extractComments(events),
    events: toPublicEvents(events),
  };
}
