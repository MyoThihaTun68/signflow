export type DocumentStatus = 'draft' | 'pending_cosign' | 'completed' | 'rejected';

export type AuditEventType = 'created' | 'sent' | 'viewed' | 'otp_verified' | 'signed' | 'completed';

export type Decision = 'approved' | 'approved_with_notes' | 'rejected';

export type OrgRole = string;

export const DEFAULT_ROLES: string[] = ['director', 'boss', 'hr', 'finance'];

export const ORG_ROLE_LABELS: Record<string, string> = {
  hr: 'HR',
  director: 'Director',
  boss: 'Boss',
  manager: 'Manager',
  finance: 'Finance',
  external: 'External Partner',
};

/** Formats any built-in or user-created custom role cleanly (e.g. "it_manager" or "Legal Counsel" -> "Legal Counsel"). */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Team';
  const clean = role.trim();
  const key = clean.toLowerCase();
  if (ORG_ROLE_LABELS[key]) return ORG_ROLE_LABELS[key];
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeRole(input: unknown, fallback = 'director'): string {
  if (typeof input !== 'string') return fallback;
  const trimmed = input.trim().slice(0, 40);
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  if (ORG_ROLE_LABELS[lower]) return lower;
  return trimmed;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  department: string;
  status?: 'active' | 'invited';
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface DocumentComment {
  id: string;
  authorName: string;
  authorEmail: string;
  authorRole: OrgRole;
  message: string;
  createdAt: string;
}

export interface SignerHistoryEntry {
  actorName: string;
  actorEmail: string;
  actorRole: OrgRole;
  decision: Decision;
  note: string | null;
  page: number;
  signedAt: string;
  ipAddress: string;
  sha256AfterSign: string;
  finalSeal: boolean;
}

export const DECISION_LABELS: Record<Decision, string> = {
  approved: 'Approved',
  approved_with_notes: 'Approved w/ Notes',
  rejected: 'Rejected',
};

export const EVENT_LABELS: Record<AuditEventType, string> = {
  created: 'Created',
  sent: 'Sent',
  viewed: 'Viewed',
  otp_verified: 'OTP Verified',
  signed: 'Signed',
  completed: 'Completed',
};

export interface StampConfig {
  /** zero-based page index */
  page?: number;
  /** PDF-space coordinates (points, bottom-left origin) of the stamp anchor */
  x?: number;
  y?: number;
  /** stamp width relative to the displayed page width (0..1) */
  scale?: number;
  /** display-space centre of the stamp as fractions of the page (top-left origin) */
  cx?: number;
  cy?: number;
  decision?: Decision;
  note?: string | null;
  seal_method?: 'p12' | 'hash';
  /** Organization & workflow metadata (stored in existing stamp_config JSONB column) */
  require_otp?: boolean;
  sender_role?: OrgRole;
  assigned_role?: OrgRole;
  signatures?: SignerHistoryEntry[];
}

export interface DocumentRecord {
  id: string;
  ref_code: string;
  title: string;
  status: DocumentStatus;
  signer1_name: string | null;
  signer1_email: string | null;
  signer2_name: string | null;
  signer2_email: string | null;
  sign_token: string;
  original_pdf_path: string | null;
  final_pdf_path: string | null;
  stage1_sha256: string | null;
  final_sha256: string | null;
  stamp_config: StampConfig | null;
  created_at: string;
  completed_at: string | null;
}

export interface AuditEvent {
  id: string;
  document_id: string;
  event_type: AuditEventType;
  actor_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OtpRecord {
  id: string;
  document_id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  verified: boolean;
  attempts: number;
  created_at: string;
}

export interface PublicAuditEvent {
  type: AuditEventType;
  label: string;
  actorEmail: string | null;
  actorName?: string | null;
  actorRole?: OrgRole | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail?: string | null;
  createdAt: string;
}

/** Shape returned to the browser for a signing link (no secrets). */
export interface PublicDocument {
  refCode: string;
  title: string;
  status: DocumentStatus;
  signer1Name: string | null;
  signer1Email: string | null;
  signer2Name: string | null;
  signer2Email: string | null;
  signer2EmailMasked: string | null;
  senderRole: OrgRole;
  assignedRole: OrgRole;
  requireOtp: boolean;
  createdAt: string;
  completedAt: string | null;
  stage1Sha256: string | null;
  finalSha256: string | null;
  decision: Decision | null;
  sessionVerified: boolean;
  signatures: SignerHistoryEntry[];
  comments: DocumentComment[];
  events: PublicAuditEvent[];
}

export type VerifyResult =
  | {
      status: 'verified';
      stage: 'final' | 'original';
      refCode: string;
      title: string;
      documentStatus: DocumentStatus;
      signer1Name: string | null;
      signer2Name: string | null;
      createdAt: string;
      completedAt: string | null;
      sha256: string;
      signatures?: SignerHistoryEntry[];
      events: PublicAuditEvent[];
    }
  | { status: 'tampered'; refCode: string; title: string; sha256: string }
  | { status: 'unregistered'; sha256: string };
