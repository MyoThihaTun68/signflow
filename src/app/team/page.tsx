'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { RolePicker, useCustomRoles } from '@/components/RolePicker';
import { useToast } from '@/components/Toast';
import {
  roleLabel,
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
  decision: Decision | null;
  signatures: SignerHistoryEntry[];
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

  const [roleFilter, setRoleFilter] = useState<'all' | OrgRole>('all');
  const [viewTab, setViewTab] = useState<'papers' | 'members' | 'history'>('papers');
  const { allRoles } = useCustomRoles(roster.map((m) => m.role));

  // Simple Invite Form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<OrgRole>('director');
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
          department: roleLabel(newRole),
          sendInvite: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not invite member.');
      setRoster(data.roster ?? []);
      setNewName('');
      setNewEmail('');
      refreshAuth();
      if (data.inviteUrl) {
        await navigator.clipboard.writeText(data.inviteUrl).catch(() => undefined);
      }
      if (data.inviteDelivered) {
        toast(`Email invite sent via ${String(data.inviteTransport || 'Supabase').toUpperCase()} (& link copied)!`, 'ok');
      } else {
        toast(
          data.inviteError
            ? `Added to team (email note: ${data.inviteError}) — invite link copied!`
            : `Added ${roleLabel(newRole)} — invite link copied to clipboard!`,
          'warn',
        );
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to invite member', 'err');
    } finally {
      setSavingMember(false);
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
    if (data.inviteUrl) {
      await navigator.clipboard.writeText(data.inviteUrl);
      toast(`Invite link for ${m.name} copied!`, 'ok');
    }
  };

  const filteredDocs = documents.filter((d) => {
    if (roleFilter === 'all') return true;
    return (
      d.assignedRole === roleFilter ||
      d.senderRole === roleFilter ||
      d.signatures.some((s) => s.actorRole === roleFilter)
    );
  });

  return (
    <div className="stack">
      {/* ── Top Welcome / Sign-In Banner ── */}
      {user ? (
        <div className="card card-hero row-between">
          <div className="row">
            <span className="badge badge-ok">✓ Signed In</span>
            <strong>{user.name}</strong>
            <span className="badge badge-primary">{roleLabel(user.role)}</span>
            <span className="muted small">({user.email})</span>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRoleFilter(roleFilter === user.role ? 'all' : user.role)}
            >
              {roleFilter === user.role ? 'Show All Team Papers' : `Show Only My ${roleLabel(user.role)} Papers`}
            </button>
            <Link href="/" className="btn btn-primary btn-sm">
              + Upload New Paper
            </Link>
          </div>
        </div>
      ) : (
        <div className="card card-hero row-between">
          <div>
            <h2>Team Workspace (Director · Boss · HR · Finance + Custom Roles)</h2>
            <p className="muted small">
              First time? Click <strong>Create Account</strong> with your email. Already have an account? Click{' '}
              <strong>Sign In</strong>.
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => openAuthModal('login')}>
              Sign In
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openAuthModal('register')}>
              Create Account
            </button>
          </div>
        </div>
      )}

      {/* ── Simple 3-Tab Switcher inside Team Hub ── */}
      <div className="row-between" data-tour="team-tabs">
        <div className="seg">
          <button
            type="button"
            className={viewTab === 'papers' ? 'active' : ''}
            onClick={() => setViewTab('papers')}
          >
            📄 Team Papers ({documents.length})
          </button>
          <button
            type="button"
            className={viewTab === 'members' ? 'active' : ''}
            onClick={() => setViewTab('members')}
          >
            👥 Team &amp; Email Invites ({roster.length})
          </button>
          <button
            type="button"
            className={viewTab === 'history' ? 'active' : ''}
            onClick={() => setViewTab('history')}
          >
            🕒 History Log ({activity.length})
          </button>
        </div>

        {viewTab === 'papers' && (
          <div className="seg">
            <button type="button" className={roleFilter === 'all' ? 'active' : ''} onClick={() => setRoleFilter('all')}>
              All
            </button>
            {allRoles.map((r) => (
              <button key={r} type="button" className={roleFilter.toLowerCase() === r.toLowerCase() ? 'active' : ''} onClick={() => setRoleFilter(r)}>
                {roleLabel(r)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab 1: Papers & Who Signed What ── */}
      {viewTab === 'papers' && (
        <div className="card stack">
          {loading ? (
            <div className="stack" aria-busy="true" aria-label="Loading papers">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="row-between"
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="stack-sm" style={{ flex: 1 }}>
                    <div className="row">
                      <div className="skel skel-pill" style={{ width: 84 }} />
                      <div className="skel skel-line" style={{ width: '42%', height: 18 }} />
                      <div className="skel skel-pill" style={{ width: 110 }} />
                    </div>
                    <div className="row">
                      <div className="skel skel-pill" style={{ width: 130 }} />
                      <div className="skel skel-pill" style={{ width: 145 }} />
                    </div>
                  </div>
                  <div className="skel skel-line" style={{ width: 120, height: 34, borderRadius: 10 }} />
                </div>
              ))}
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="stack" style={{ padding: '28px 0', textAlign: 'center' }}>
              <h3>No papers yet</h3>
              <p className="muted small">Upload or scan a paper to send it to Director, Boss, HR, Finance, or any custom role.</p>
              <div>
                <Link href="/" className="btn btn-primary">
                  + Upload / Scan First Paper
                </Link>
              </div>
            </div>
          ) : (
            <div className="stack">
              {filteredDocs.map((d) => (
                <div
                  key={d.id}
                  className="row-between"
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="stack-sm">
                    <div className="row">
                      <code>{d.refCode}</code>
                      <strong style={{ fontSize: '1.05rem' }}>{d.title}</strong>
                      {d.status === 'completed' ? (
                        <span className="badge badge-ok">✓ Completed</span>
                      ) : d.status === 'rejected' ? (
                        <span className="badge badge-danger">✕ Rejected</span>
                      ) : (
                        <span className="badge badge-warn">⏳ Waiting for {roleLabel(d.assignedRole)}</span>
                      )}
                    </div>

                    {/* Visual Step Chain: Who Prepared -> Who Signed -> Who is Next */}
                    <div className="row small">
                      <span className="badge badge-muted">
                        From {roleLabel(d.senderRole)} ({d.signer1Name || d.signer1Email})
                      </span>
                      {d.signatures.map((s, idx) => (
                        <span key={idx} className="badge badge-ok">
                          → ✓ {roleLabel(s.actorRole)} ({s.actorName})
                        </span>
                      ))}
                      {d.status === 'pending_cosign' && (
                        <span className="badge badge-primary">
                          → Next: {roleLabel(d.assignedRole)} ({d.signer2Name || d.signer2Email})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="row">
                    <Link href={`/sign/${d.signToken}`} className="btn btn-primary">
                      {d.status === 'pending_cosign' ? 'Open & Sign →' : 'View Paper →'}
                    </Link>
                    <a href={`/api/documents/${d.signToken}/file?download=1`} className="btn" title="Download PDF">
                      PDF ↓
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Team Members & Email Invites ── */}
      {viewTab === 'members' && (
        <div className="grid-2">
          <div className="card stack">
            <h2>Team Members ({roster.length})</h2>
            <div className="stack-sm">
              {roster.map((m) => (
                <div
                  key={m.id}
                  className="row-between"
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="row">
                    <span className="badge badge-primary">{roleLabel(m.role)}</span>
                    <div>
                      <strong>{m.name}</strong>
                      <div className="small muted">{m.email}</div>
                    </div>
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
                      >
                        Set Password
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => copyInviteLink(m)}>
                      Copy Invite Link
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card stack">
            <h2>Invite Teammate by Email</h2>
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
                  placeholder="boss@company.la"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </label>
              <div className="field">
                <span>Role (Director / Boss / HR / Finance or + Custom)</span>
                <RolePicker
                  value={newRole}
                  onChange={setNewRole}
                  extraRoles={roster.map((m) => m.role)}
                  allowDeleteCustom
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={savingMember}>
                {savingMember ? 'Inviting...' : '+ Send Email Invite & Copy Link'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Tab 3: Full Traceable History Log ── */}
      {viewTab === 'history' && (
        <div className="card stack">
          <h2>Traceable History Log ({activity.length})</h2>
          {activity.length === 0 ? (
            <p className="muted small">No events yet.</p>
          ) : (
            <ul className="timeline">
              {activity.map((ev, i) => (
                <li key={i} className={ev.type}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="t-title">{ev.label}</span>
                    {ev.actorRole && <span className="badge badge-primary">{roleLabel(ev.actorRole)}</span>}
                    {ev.signToken && (
                      <Link href={`/sign/${ev.signToken}`} className="badge badge-muted">
                        {ev.refCode} · {ev.documentTitle}
                      </Link>
                    )}
                  </div>
                  {ev.detail && <div className="small">&ldquo;{ev.detail}&rdquo;</div>}
                  <div className="t-meta">
                    {new Date(ev.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
                    {ev.actorName ? ` · ${ev.actorName}` : ''}
                    {ev.actorEmail ? ` (${ev.actorEmail})` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
