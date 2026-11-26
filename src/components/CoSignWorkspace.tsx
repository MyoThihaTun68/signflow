'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PdfCanvasViewer } from '@/components/PdfCanvasViewer';
import { RolePicker, useCustomRoles } from '@/components/RolePicker';
import { SignatureCreator } from '@/components/SignatureCreator';
import { useToast } from '@/components/Toast';
import { uid } from '@/lib/client/image';
import {
  roleLabel,
  type Decision,
  type OrgRole,
  type PublicDocument,
  type TeamMember,
} from '@/lib/types';

interface LocalStamp {
  id: string;
  page: number;
  cx: number;
  cy: number;
  widthFrac: number;
}

export function CoSignWorkspace({ token }: { token: string }) {
  const { toast } = useToast();
  const { user, openAuthModal, saveSignature } = useAuth();

  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [nextPendingToken, setNextPendingToken] = useState<{ token: string; title: string } | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [stamps, setStamps] = useState<LocalStamp[]>([
    { id: 'stamp-1', page: 0, cx: 0.72, cy: 0.82, widthFrac: 0.24 },
  ]);
  const [activeStampId, setActiveStampId] = useState<string>('stamp-1');
  const [decision, setDecision] = useState<Decision>('approved');
  const [note, setNote] = useState('');
  const [signerRole, setSignerRole] = useState<OrgRole>('director');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [editingNewSig, setEditingNewSig] = useState(false);

  const [nextTarget, setNextTarget] = useState<'finish' | OrgRole>('finish');
  const [showHistory, setShowHistory] = useState(false);
  const { allRoles } = useCustomRoles(roster.map((m) => m.role));

  const [sealing, setSealing] = useState(false);
  const [sealErr, setSealErr] = useState<string | null>(null);

  // Chat
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const viewedLogged = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    (async () => {
      try {
        const [docRes, teamRes] = await Promise.all([
          fetch(`/api/documents/${token}`, { cache: 'no-store' }),
          fetch('/api/team', { cache: 'no-store' }).catch(() => null),
        ]);
        const data = await docRes.json();
        if (!docRes.ok) throw new Error(data.error || 'Document not found.');
        if (cancelled) return;
        const pub = data as PublicDocument;
        setDoc(pub);
        setSignerRole(pub.assignedRole || 'director');
        setSignerName(pub.signer2Name || '');
        setSignerEmail(pub.signer2Email || '');

        if (teamRes && teamRes.ok) {
          const tData = await teamRes.json();
          if (tData?.roster?.length) setRoster(tData.roster as TeamMember[]);
          if (Array.isArray(tData?.documents)) {
            const otherPending = tData.documents.find(
              (d: { signToken: string; status: string; title: string }) =>
                d.signToken !== token && d.status === 'pending_cosign',
            );
            if (otherPending) setNextPendingToken({ token: otherPending.signToken, title: otherPending.title });
          }
        }

        if (!viewedLogged.current) {
          viewedLogged.current = true;
          fetch(`/api/documents/${token}/view`, { method: 'POST' }).catch(() => undefined);
        }

        const pdfRes = await fetch(`/api/documents/${token}/file`, { cache: 'no-store' });
        if (!pdfRes.ok) throw new Error('Could not load PDF file.');
        const bytes = new Uint8Array(await pdfRes.arrayBuffer());
        if (!cancelled) setPdfBytes(bytes);
      } catch (err) {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : 'Failed to load document.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Auto-load signed-in user identity AND saved 1-click signature!
  useEffect(() => {
    if (user) {
      setSignerRole(user.role);
      setSignerName(user.name);
      setSignerEmail(user.email);
      if (user.savedSignature && !signaturePng && !editingNewSig) {
        setSignaturePng(user.savedSignature);
      }
    }
  }, [user, signaturePng, editingNewSig]);

  const switchActiveRole = (role: OrgRole) => {
    setSignerRole(role);
    const match = roster.find((m) => m.role.toLowerCase() === role.toLowerCase());
    if (match) {
      setSignerName(match.name);
      setSignerEmail(match.email);
    } else if (!user) {
      setSignerName(roleLabel(role));
      setSignerEmail(`${role.toLowerCase().replace(/\s+/g, '.')}@signflow.org`);
    }
  };

  const addAnotherStamp = () => {
    const id = `stamp-${uid().slice(0, 6)}`;
    const nextCx = stamps.length % 2 === 0 ? 0.28 : 0.72;
    const nextCy = Math.max(0.2, 0.82 - (stamps.length % 3) * 0.14);
    setStamps((prev) => [...prev, { id, page, cx: nextCx, cy: nextCy, widthFrac: 0.22 }]);
    setActiveStampId(id);
    toast(`Added stamp #${stamps.length + 1} on page ${page + 1} — drag or resize its corner`, 'info');
  };

  const updateStampPos = (p: number, cx: number, cy: number, sid?: string) => {
    const targetId = sid || activeStampId;
    setStamps((prev) => prev.map((s) => (s.id === targetId ? { ...s, page: p, cx, cy } : s)));
  };

  const updateStampSize = (widthFrac: number, sid?: string) => {
    const targetId = sid || activeStampId;
    setStamps((prev) => prev.map((s) => (s.id === targetId ? { ...s, widthFrac } : s)));
  };

  const removeStamp = (sid: string) => {
    setStamps((prev) => {
      const next = prev.filter((s) => s.id !== sid);
      if (next.length && activeStampId === sid) setActiveStampId(next[0].id);
      return next.length ? next : prev;
    });
  };

  const sealDocument = async () => {
    if (!signaturePng) return setSealErr('Step 1: Draw or type your signature first.');
    if (decision === 'approved_with_notes' && !note.trim()) return setSealErr('Please type a short note.');

    setSealing(true);
    setSealErr(null);
    try {
      const forwardRole = nextTarget !== 'finish' && decision !== 'rejected' ? nextTarget : null;
      const forwardMember = forwardRole ? roster.find((m) => m.role.toLowerCase() === forwardRole.toLowerCase()) : null;

      const res = await fetch(`/api/documents/${token}/seal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: signaturePng,
          stamps: stamps.map((s) => ({
            page: s.page,
            cx: s.cx,
            cy: s.cy,
            widthFrac: s.widthFrac,
            signature: signaturePng,
          })),
          decision,
          note: note.trim() || null,
          signerName: signerName.trim() || roleLabel(signerRole),
          signerEmail: signerEmail.trim() || `${signerRole.toLowerCase().replace(/\s+/g, '.')}@signflow.org`,
          signerRole,
          forwardToRole: forwardRole,
          forwardToName: forwardMember?.name || (forwardRole ? roleLabel(forwardRole) : null),
          forwardToEmail:
            forwardMember?.email || (forwardRole ? `${forwardRole.toLowerCase().replace(/\s+/g, '.')}@signflow.org` : null),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to stamp document.');
      if (data.document) {
        const updated = data.document as PublicDocument;
        setDoc(updated);
        if (data.forwardedToRole) {
          switchActiveRole(data.forwardedToRole as OrgRole);
          setNextTarget('finish');
          setNote('');
          toast(`Stamped & sent to ${roleLabel(data.forwardedToRole)}!`, 'ok');
        } else {
          toast('Paper signed & completed!', 'ok');
        }
      }

      const finalRes = await fetch(`/api/documents/${token}/file?t=${Date.now()}`, { cache: 'no-store' });
      if (finalRes.ok) {
        setPdfBytes(new Uint8Array(await finalRes.arrayBuffer()));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSealErr(err instanceof Error ? err.message : 'Failed to stamp document.');
    } finally {
      setSealing(false);
    }
  };

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    setChatBusy(true);
    try {
      const res = await fetch(`/api/documents/${token}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: signerName || roleLabel(signerRole),
          authorEmail: signerEmail || `${signerRole.toLowerCase().replace(/\s+/g, '.')}@signflow.org`,
          authorRole: signerRole,
          message: chatText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post comment.');
      setChatText('');
      setDoc((prev) => (prev ? { ...prev, comments: data.comments, events: data.events } : prev));
      toast('Message sent', 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send message', 'err');
    } finally {
      setChatBusy(false);
    }
  };

  if (loadErr) {
    return (
      <div className="card stack">
        <h2>Paper not found</h2>
        <div className="alert alert-danger">{loadErr}</div>
        <div className="row">
          <Link href="/team" className="btn btn-primary">
            Go to Team Hub
          </Link>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="stack" aria-busy="true" aria-label="Loading paper">
        <div className="card row-between" style={{ padding: '14px 20px' }}>
          <div className="row" style={{ flex: 1 }}>
            <div className="skel skel-pill" style={{ width: 90 }} />
            <div className="skel skel-line" style={{ width: '32%', height: 20 }} />
            <div className="skel skel-pill" style={{ width: 130 }} />
          </div>
          <div className="skel skel-pill" style={{ width: 100 }} />
        </div>
        <div className="grid-split">
          <div className="card stack">
            <div className="skel skel-line" style={{ width: '45%', height: 20 }} />
            <div className="skel skel-box" style={{ height: 480 }} />
          </div>
          <div className="card stack">
            <div className="skel skel-line" style={{ width: '50%', height: 20 }} />
            <div className="skel skel-line" style={{ width: '100%', height: 38 }} />
            <div className="skel skel-box" style={{ height: 150 }} />
            <div className="skel skel-line" style={{ width: '100%', height: 46, borderRadius: 12 }} />
          </div>
        </div>
      </div>
    );
  }

  const isDone = doc.status === 'completed' || doc.status === 'rejected';
  const activeStamp = stamps.find((s) => s.id === activeStampId) ?? stamps[0];

  return (
    <div className="stack">
      {/* ── Clear Visual Progress Tracker ── */}
      <div className="card row-between" style={{ padding: '14px 20px' }}>
        <div className="row" style={{ gap: 10 }}>
          <code>{doc.refCode}</code>
          <strong style={{ fontSize: '1.05rem' }}>{doc.title}</strong>
          <span className="muted">·</span>
          <span className="badge badge-muted">From {roleLabel(doc.senderRole)}</span>
          <span>→</span>
          {doc.signatures.map((s, i) => (
            <span key={i} className="badge badge-ok">
              ✓ {roleLabel(s.actorRole)} Signed
            </span>
          ))}
          {!isDone ? (
            <span className="badge badge-warn">⏳ Waiting for {roleLabel(doc.assignedRole)}</span>
          ) : (
            <span className={`badge ${doc.status === 'rejected' ? 'badge-danger' : 'badge-ok'}`}>
              {doc.status === 'rejected' ? '✕ Rejected' : '✓ Completed'}
            </span>
          )}
        </div>
        <div className="row">
          <a className="btn btn-sm" href={`/api/documents/${token}/file?download=1`}>
            Download PDF ↓
          </a>
          <Link className="btn btn-sm" href="/team">
            Team Hub
          </Link>
        </div>
      </div>

      {/* ── Split Workspace: 70% Paper Left / Compact Floating Inspector Right ── */}
      <div className="grid-split">
        <div className="stack">
          <div className="card stack">
            <div className="row-between">
              <h2>
                {isDone
                  ? 'Signed Paper'
                  : 'Tap Page to Move · Drag Blue Corner Dot to Resize'}
              </h2>
              {!isDone && signaturePng && (
                <div className="row">
                  <button type="button" className="btn btn-sm btn-primary" onClick={addAnotherStamp}>
                    + Add Stamp ({stamps.length})
                  </button>
                  <div className="seg">
                    <button type="button" onClick={() => updateStampPos(page, 0.25, 0.82)}>
                      Left
                    </button>
                    <button type="button" onClick={() => updateStampPos(page, 0.5, 0.82)}>
                      Center
                    </button>
                    <button type="button" onClick={() => updateStampPos(page, 0.75, 0.82)}>
                      Right
                    </button>
                  </div>
                </div>
              )}
            </div>

            <PdfCanvasViewer
              data={pdfBytes}
              page={page}
              onPageChange={setPage}
              interactive={!isDone && Boolean(signaturePng)}
              stamps={
                !isDone && signaturePng
                  ? stamps.map((s) => ({
                      id: s.id,
                      page: s.page,
                      cx: s.cx,
                      cy: s.cy,
                      widthFrac: s.widthFrac,
                      png: signaturePng,
                    }))
                  : []
              }
              activeStampId={activeStampId}
              onSelectStamp={setActiveStampId}
              onRemoveStamp={removeStamp}
              onPlace={updateStampPos}
              onResize={updateStampSize}
            />
          </div>

          {/* ── Simple Team Chat Box ── */}
          <div className="card stack">
            <div className="row-between">
              <h2>Team Chat on This Paper ({doc.comments.length})</h2>
              <button type="button" className="btn btn-sm" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? 'Hide History Log' : `View Full History Log (${doc.events.length})`}
              </button>
            </div>

            {doc.comments.length > 0 && (
              <div className="stack-sm">
                {doc.comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '9px 13px',
                      borderRadius: 12,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="row-between">
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge badge-primary">{roleLabel(c.authorRole)}</span>
                        <strong>{c.authorName}</strong>
                      </div>
                      <span className="small muted">
                        {new Date(c.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
                      </span>
                    </div>
                    <p style={{ marginTop: 4 }}>{c.message}</p>
                  </div>
                ))}
              </div>
            )}

            <form className="copy-field" onSubmit={postComment}>
              <input
                className="input"
                placeholder={`Write a message to team as ${roleLabel(signerRole)}...`}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={chatBusy || !chatText.trim()}>
                Send
              </button>
            </form>

            {showHistory && (
              <ul className="timeline" style={{ marginTop: 8 }}>
                {doc.events.map((ev, i) => (
                  <li key={i} className={ev.type}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="t-title">{ev.label}</span>
                      {ev.actorRole && <span className="badge badge-primary">{roleLabel(ev.actorRole)}</span>}
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
        </div>

        {/* ── Right: Compact Floating iOS Inspector ── */}
        <div className="stack sticky">
          {isDone ? (
            <div className="card card-hero stack">
              <h2>✓ Paper Completed</h2>
              <p className="muted small">
                Signed by {doc.signatures.map((s) => `${roleLabel(s.actorRole)} (${s.actorName})`).join(' → ')}.
              </p>
              <a className="btn btn-primary btn-lg btn-block" href={`/api/documents/${token}/file?type=final&download=1`}>
                Download Signed PDF
              </a>
              {nextPendingToken && (
                <Link className="btn btn-lg btn-block" href={`/sign/${nextPendingToken.token}`}>
                  Next Pending Paper: {nextPendingToken.title} →
                </Link>
              )}
              <Link className="btn btn-block" href="/team">
                Back to Team Hub
              </Link>
            </div>
          ) : (
            <div className="card stack">
              <div className="row-between">
                <h2>Sign This Paper</h2>
                {!user && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openAuthModal('login', { email: signerEmail, name: signerName, role: signerRole })}
                  >
                    Sign In
                  </button>
                )}
              </div>

              {/* 1. Role */}
              <div className="field">
                <span>1. Your Role</span>
                <RolePicker
                  value={signerRole}
                  onChange={switchActiveRole}
                  extraRoles={roster.map((m) => m.role)}
                  allowDeleteCustom
                />
              </div>

              <div className="fields-2">
                <label className="field">
                  <span>Your Name</span>
                  <input className="input" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                </label>
                <label className="field">
                  <span>Decision</span>
                  <select
                    className="select"
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as Decision)}
                  >
                    <option value="approved">✓ Approved</option>
                    <option value="approved_with_notes">✎ Approved w/ Note</option>
                    <option value="rejected">✕ Rejected</option>
                  </select>
                </label>
              </div>

              {/* 2. Saved 1-Click Signature OR Signature Creator */}
              <div className="field">
                <div className="row-between">
                  <span>2. Your Signature</span>
                  {user && signaturePng && user.savedSignature !== signaturePng && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => saveSignature(signaturePng)}
                    >
                      ★ Save to My Profile
                    </button>
                  )}
                </div>

                {user?.savedSignature && !editingNewSig ? (
                  <div className="stack-sm">
                    <div className="sig-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={user.savedSignature} alt="Your saved signature" />
                    </div>
                    <div className="row-between">
                      <span className="badge badge-ok">⚡ 1-Click Saved Signature Loaded</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setEditingNewSig(true)}
                      >
                        Draw / Upload New
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="stack-sm">
                    <SignatureCreator
                      allowPhoto
                      defaultText={signerName}
                      value={signaturePng}
                      onChange={setSignaturePng}
                    />
                    {user?.savedSignature && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setSignaturePng(user.savedSignature ?? null);
                          setEditingNewSig(false);
                        }}
                      >
                        ← Use My Saved Signature
                      </button>
                    )}
                  </div>
                )}
              </div>

              {activeStamp && (
                <label className="field">
                  <span>Stamp Size (or drag corner dot on paper)</span>
                  <div className="range-row">
                    <input
                      type="range"
                      min={10}
                      max={50}
                      value={Math.round(activeStamp.widthFrac * 100)}
                      onChange={(e) => updateStampSize(Number(e.target.value) / 100)}
                    />
                    <output>{Math.round(activeStamp.widthFrac * 100)}%</output>
                  </div>
                </label>
              )}

              <label className="field">
                <span>Short Note (optional)</span>
                <input
                  className="input"
                  placeholder="Optional comment..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              {/* 3. Finish or Pass to Another Role */}
              {decision !== 'rejected' && (
                <div className="field">
                  <span>3. After You Sign:</span>
                  <div className="seg full">
                    <button
                      type="button"
                      className={nextTarget === 'finish' ? 'active' : ''}
                      onClick={() => setNextTarget('finish')}
                    >
                      ✓ Finish &amp; Complete
                    </button>
                    {allRoles
                      .filter((r) => r.toLowerCase() !== signerRole.toLowerCase())
                      .slice(0, 3)
                      .map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={nextTarget === r ? 'active' : ''}
                          onClick={() => setNextTarget(r)}
                        >
                          → Next: {roleLabel(r)}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {sealErr && <div className="alert alert-danger">{sealErr}</div>}

              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={sealing}
                onClick={sealDocument}
              >
                {sealing
                  ? 'Stamping Paper...'
                  : nextTarget !== 'finish' && decision !== 'rejected'
                    ? `Stamp & Send Next to ${roleLabel(nextTarget)} →`
                    : `Stamp as ${roleLabel(signerRole)} & Complete ✓`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
