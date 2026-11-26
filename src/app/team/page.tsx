'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/Toast';
import {
  DECISION_LABELS,
  ORG_ROLE_LABELS,
  type Decision,
  type DocumentStatus,
  type OrgRole,
  type PublicAuditEvent,
  type SignerHistoryEntry,
  type TeamMember,
} from '@/lib/types';

interface TeamDocItem {
  id: string;
  refCode: string;
  title: string;
  status: DocumentStatus;
  signToken: string;
  signer1Name: string | null;
  signer1Email: string | null;
  signer2Name: string | null;
  signer2Email: string | null;
  senderRole: OrgRole;
  assignedRole: OrgRole;
  requireOtp: boolean;
  decision: Decision | null;
  signatures: SignerHistoryEntry[];
  stage1Sha256: string | null;
  finalSha256: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ActivityItem extends PublicAuditEvent {
  refCode: string;
  documentTitle: string;
  signToken: string | null;
}

export default function TeamHubPage() {
  const { toast } = useToast();
  const { user, openAuthModal, refreshAuth } = useAuth();
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [documents, setDocuments] = useState<TeamDocItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter by role or email
  const [roleFilter, setRoleFilter] = useState<'all' | OrgRole>('all');
  const [search, setSearch] = useState('');

  // Create / Invite Team Member form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('director');
  const [newDept, setNewDept] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [savingMember, setSavingMember] = useState(false);

  const loadHub = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/team', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setRoster(data.roster ?? []);
        setDocuments(data.documents ?? []);
        setActivity(data.activity ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;
    setSavingMember(true);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          role: newRole,
          department: newDept.trim() || ORG_ROLE_LABELS[newRole],
          sendInvite,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add team member.');
      setRoster(data.roster ?? []);
      setNewName('');
      setNewEmail('');
      setNewDept('');
      refreshAuth();
      if (data.inviteUrl) {
        await navigator.clipboard.writeText(data.inviteUrl).catch(() => undefined);
      }
      toast(
        data.inviteDelivered
          ? `Invited ${ORG_ROLE_LABELS[newRole]} by email (& copied invite link)`
          : `Added ${ORG_ROLE_LABELS[newRole]} — personal invite link copied to clipboard!`,
        'ok',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save member', 'err');
    } finally {
      setSavingMember(false);
    }
  };

  const handleRemoveMember = async (id: string, name: string) => {
    const res = await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id }),
    });
    const data = await res.json();
    if (res.ok) {
      setRoster(data.roster ?? []);
      toast(`Removed ${name}`, 'info');
    }
  };

  const copyInviteLink = async (m: TeamMember) => {
    const res = await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: m.name,
        email: m.email,
        role: m.role,
        department: m.department,
        sendInvite: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const url =
      data.inviteUrl ||
      `${window.location.origin}/team?email=${encodeURIComponent(m.email)}&role=${encodeURIComponent(m.role)}`;
    await navigator.clipboard.writeText(url);
    toast(`Personal setup link for ${m.name} copied!`, 'ok');
  };

  const filteredDocs = documents.filter((d) => {
    if (roleFilter !== 'all') {
      const inRole =
        d.assignedRole === roleFilter ||
        d.senderRole === roleFilter ||
        d.signatures.some((s) => s.actorRole === roleFilter);
      if (!inRole) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${d.refCode} ${d.title} ${d.signer1Name ?? ''} ${d.signer1Email ?? ''} ${d.signer2Name ?? ''} ${d.signer2Email ?? ''} ${d.signatures.map((s) => `${s.actorName} ${s.actorEmail}`).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="badge badge-primary">Organization Workspace</span>
            <span className="badge badge-ok">HR ↔ Director ↔ Boss Connected</span>
          </div>
          <h1>Team Hub &amp; Signature Traceability</h1>
          <p>
            Create and invite organization members by email, switch between <strong>HR</strong>,{' '}
            <strong>Director</strong>, and <strong>Boss</strong> queues, and trace who signed which paper with full
            chronological history logs.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={loadHub} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh Board'}
          </button>
          <Link href="/" className="btn btn-primary">
            + Scan / Prepare New Document
          </Link>
        </div>
      </div>

      {/* ── Signed-in Account / First-Time Setup Banner ── */}
      {user ? (
        <div className="card card-hero row-between">
          <div className="row">
            <span className="badge badge-ok">✓ Signed In</span>
            <strong>{user.name}</strong>
            <span className="muted small">({user.email})</span>
            <span className="badge badge-primary">{ORG_ROLE_LABELS[user.role]}</span>
            <span className="muted small">· {user.department}</span>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRoleFilter(roleFilter === user.role ? 'all' : user.role)}
            >
              {roleFilter === user.role ? 'Show All Team Papers' : `Filter My ${ORG_ROLE_LABELS[user.role]} Queue`}
            </button>
          </div>
        </div>
      ) : (
        <div className="card card-hero row-between">
          <div>
            <h2>First Time Here? Create Your Team Account or Sign In</h2>
            <p className="muted small">
              Create your account once with your organization email &amp; role (<strong>HR</strong>,{' '}
              <strong>Director</strong>, or <strong>Boss</strong>). Next time, sign in with one click.
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => openAuthModal('login')}>
              Sign In with Email
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openAuthModal('register')}>
              First-Time Create Account
            </button>
          </div>
        </div>
      )}

      {/* ── Role Filter Bar & Search ── */}
      <div className="card row-between">
        <div className="row">
          <span className="small muted" style={{ fontWeight: 600 }}>
            View Queue by Role:
          </span>
          <div className="seg">
            <button type="button" className={roleFilter === 'all' ? 'active' : ''} onClick={() => setRoleFilter('all')}>
              All Team ({documents.length})
            </button>
            {(['hr', 'director', 'boss', 'finance'] as OrgRole[]).map((r) => (
              <button key={r} type="button" className={roleFilter === r ? 'active' : ''} onClick={() => setRoleFilter(r)}>
                {ORG_ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search ref code, paper title, or signer email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid-2">
        {/* ── Left: Shared Team Document Board & Signature Traceability ── */}
        <div className="stack">
          <div className="card stack">
            <div className="row-between">
              <h2>Organization Papers &amp; Who Signed What ({filteredDocs.length})</h2>
              <span className="badge badge-muted">Click any paper to open, chat, or sign</span>
            </div>

            {loading ? (
              <div className="muted small">
                <span className="spinner" /> Loading team documents...
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="stack" style={{ padding: '20px 0', textAlign: 'center' }}>
                <p className="muted">No documents match this filter yet.</p>
                <div>
                  <Link href="/" className="btn btn-primary btn-sm">
                    Prepare First Team Document
                  </Link>
                </div>
              </div>
            ) : (
              <div className="stack">
                {filteredDocs.map((d) => (
                  <div
                    key={d.id}
                    className="stack-sm"
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="row-between">
                      <div className="row">
                        <code>{d.refCode}</code>
                        <strong style={{ fontSize: '1rem' }}>{d.title}</strong>
                        <span className="badge badge-muted">From: {ORG_ROLE_LABELS[d.senderRole]}</span>
                        <span className="badge badge-primary">Assigned: {ORG_ROLE_LABELS[d.assignedRole]}</span>
                        {d.status === 'completed' && <span className="badge badge-ok">✓ Completed</span>}
                        {d.status === 'rejected' && <span className="badge badge-danger">✕ Rejected</span>}
                        {d.status === 'pending_cosign' && <span className="badge badge-warn">⏳ Pending Sign</span>}
                      </div>
                      <div className="row">
                        <Link href={`/sign/${d.signToken}`} className="btn btn-primary btn-sm">
                          {d.status === 'pending_cosign' ? 'Open, Chat & Sign →' : 'View Paper & Thread →'}
                        </Link>
                        <a
                          href={`/api/documents/${d.signToken}/file?download=1`}
                          className="btn btn-sm"
                          title="Download latest PDF"
                        >
                          PDF ↓
                        </a>
                      </div>
                    </div>

                    <div className="small muted">
                      Prepared by <strong>{d.signer1Name || d.signer1Email || 'HR'}</strong> on{' '}
                      {new Date(d.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC · Current assignee:{' '}
                      <strong>
                        {d.signer2Name || d.signer2Email} ({ORG_ROLE_LABELS[d.assignedRole]})
                      </strong>
                    </div>

                    {/* Traceable chain of who signed this paper */}
                    {d.signatures.length > 0 ? (
                      <div className="stack-sm" style={{ marginTop: 4 }}>
                        <div className="small" style={{ fontWeight: 630 }}>
                          Signed By ({d.signatures.length}):
                        </div>
                        {d.signatures.map((s, idx) => (
                          <div
                            key={idx}
                            className="row-between small"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 9,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <div className="row">
                              <span className="badge badge-ok">
                                #{idx + 1} {ORG_ROLE_LABELS[s.actorRole]}
                              </span>
                              <strong>{s.actorName}</strong>
                              <span className="muted">({s.actorEmail})</span>
                              <span>· Page {s.page}</span>
                              {s.note && <span className="muted">· &ldquo;{s.note}&rdquo;</span>}
                            </div>
                            <span className="muted mono">
                              {new Date(s.signedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="small muted">No signature stamps applied yet — awaiting {ORG_ROLE_LABELS[d.assignedRole]}.</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Organization-Wide Audit & Activity Log ── */}
          <div className="card stack">
            <div className="row-between">
              <h2>Organization-Wide Traceable History Log ({activity.length})</h2>
              <span className="badge badge-primary">Real-Time Audit Ledger</span>
            </div>
            {activity.length === 0 ? (
              <p className="muted small">No audit events recorded yet.</p>
            ) : (
              <ul className="timeline">
                {activity.slice(0, 25).map((ev, i) => (
                  <li key={i} className={ev.type}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="t-title">{ev.label}</span>
                      {ev.actorRole && <span className="badge badge-primary">{ORG_ROLE_LABELS[ev.actorRole]}</span>}
                      {ev.signToken ? (
                        <Link href={`/sign/${ev.signToken}`} className="badge badge-muted">
                          {ev.refCode} · {ev.documentTitle}
                        </Link>
                      ) : (
                        <span className="badge badge-muted">{ev.refCode}</span>
                      )}
                    </div>
                    {ev.detail && <div style={{ fontSize: '0.88rem', margin: '3px 0' }}>&ldquo;{ev.detail}&rdquo;</div>}
                    <div className="t-meta">
                      {new Date(ev.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
                      {ev.actorName ? ` · ${ev.actorName}` : ''}
                      {ev.actorEmail ? ` (${ev.actorEmail})` : ''}
                      {ev.ipAddress ? ` · IP ${ev.ipAddress}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Right: Team Directory + Create / Invite Team Member by Email ── */}
        <div className="stack sticky">
          <div className="card stack">
            <h2>Create &amp; Invite Team Member</h2>
            <p className="muted small">
              Add your Boss, Director, HR, or Finance members by email so anyone can route documents to them or invite
              them to co-sign.
            </p>
            <form className="stack" onSubmit={handleAddMember}>
              <label className="field">
                <span>Full Name</span>
                <input
                  className="input"
                  required
                  placeholder="e.g. Khamla Vongsa"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Email Address</span>
                <input
                  className="input"
                  type="email"
                  required
                  placeholder="e.g. boss@yourcompany.la"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </label>
              <div className="field">
                <span>Role</span>
                <div className="seg full">
                  {(['hr', 'director', 'boss', 'manager', 'finance'] as OrgRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={newRole === r ? 'active' : ''}
                      onClick={() => setNewRole(r)}
                    >
                      {ORG_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Department / Title</span>
                <input
                  className="input"
                  placeholder="e.g. Executive Office"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                <span>Send Email Invitation Link</span>
              </label>
              <button type="submit" className="btn btn-primary btn-block" disabled={savingMember}>
                {savingMember ? 'Saving & Inviting...' : '+ Add & Invite to Team Hub'}
              </button>
            </form>
          </div>

          <div className="card stack">
            <div className="row-between">
              <h2>Team Directory ({roster.length})</h2>
              <span className="badge badge-ok">Active Roster</span>
            </div>
            <div className="stack-sm">
              {roster.map((m) => (
                <div
                  key={m.id}
                  className="stack-sm"
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="row-between">
                    <div className="row">
                      <span className="badge badge-primary">{ORG_ROLE_LABELS[m.role]}</span>
                      <strong>{m.name}</strong>
                      <span className={`badge ${m.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                        {m.status === 'active' ? '✓ Active' : 'Invited'}
                      </span>
                    </div>
                    <div className="row">
                      {m.status !== 'active' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            openAuthModal('register', {
                              name: m.name,
                              email: m.email,
                              role: m.role,
                              department: m.department,
                            })
                          }
                          title="First-time setup for this invited member"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => copyInviteLink(m)}
                        title="Copy personal account-activation invite link for this member"
                      >
                        Copy Invite
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleRemoveMember(m.id, m.name)}
                        title="Remove from roster"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="small muted">
                    {m.email} · {m.department}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
