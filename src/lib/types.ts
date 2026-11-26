export type DocumentStatus = 'draft' | 'pending_cosign' | 'completed' | 'rejected';

export type AuditEventType = 'created' | 'sent' | 'viewed' | 'otp_verified' | 'signed' | 'completed';

export type Decision = 'approved' | 'approved_with_notes' | 'rejected';

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
  page: number;
  /** PDF-space coordinates (points, bottom-left origin) of the stamp anchor */
  x: number;
  y: number;
  /** stamp width relative to the displayed page width (0..1) */
  scale: number;
  /** display-space centre of the stamp as fractions of the page (top-left origin) */
  cx: number;
  cy: number;
  decision: Decision;
  note: string | null;
  seal_method: 'p12' | 'hash';
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

/** Shape returned to the browser for a signing link (no secrets). */
export interface PublicDocument {
  refCode: string;
  title: string;
  status: DocumentStatus;
  signer1Name: string | null;
  signer1Email: string | null;
  signer2Name: string | null;
  signer2EmailMasked: string | null;
  createdAt: string;
  completedAt: string | null;
  stage1Sha256: string | null;
  finalSha256: string | null;
  decision: Decision | null;
  sessionVerified: boolean;
}

export interface PublicAuditEvent {
  type: AuditEventType;
  label: string;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
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
      events: PublicAuditEvent[];
    }
  | { status: 'tampered'; refCode: string; title: string; sha256: string }
  | { status: 'unregistered'; sha256: string };
