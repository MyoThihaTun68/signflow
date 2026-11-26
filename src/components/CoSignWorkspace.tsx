'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PdfCanvasViewer } from '@/components/PdfCanvasViewer';
import { SignatureCreator } from '@/components/SignatureCreator';
import { useToast } from '@/components/Toast';
import {
  DECISION_LABELS,
  ORG_ROLE_LABELS,
  type Decision,
  type OrgRole,
  type PublicDocument,
  type TeamMember,
} from '@/lib/types';

const DECISION_HEX: Record<Decision, string> = {
  approved: '#1d9a45',
  approved_with_notes: '#c96a00',
  rejected: '#d72638',
};

export function CoSignWorkspace({ token }: { token: string }) {
  const { toast } = useToast();
  const { user, openAuthModal } = useAuth();

  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [stampPos, setStampPos] = useState<{ page: number; cx: number; cy: number }>({ page: 0, cx: 0.72, cy: 0.82 });
  const [widthFrac, setWidthFrac] = useState(0.24);
  const [decision, setDecision] = useState<Decision>('approved');
  const [note, setNote] = useState('');
  const [signerRole, setSignerRole] = useState<OrgRole>('director');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);

  // Easy 1-click routing: either "Finish & Complete" or "Send Next to Boss/Director"
  const [nextTarget, setNextTarget] = useState<'finish' | OrgRole>('finish');
  const [showHistory, setShowHistory] = useState(false);

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

  useEffect(() => {
    if (user) {
      setSignerRole(user.role);
      setSignerName(user.name);
      setSignerEmail(user.email);
    }
  }, [user]);

  const switchActiveRole = (role: OrgRole) => {
    setSignerRole(role);
    const match = roster.find((m) => m.role === role);
    if (match) {
      setSignerName(match.name);
      setSignerEmail(match.email);
    }
  };

  const sealDocument = async () => {
    if (!signaturePng) return setSealErr('Step 1: Draw or type your signature first.');
    if (decision === 'approved_with_notes' && !note.trim()) return setSealErr('Please type a short note.');

    setSealing(true);
    setSealErr(null);
    try {
      const forwardRole = nextTarget !== 'finish' && decision !== 'rejected' ? nextTarget : null;
      const forwardMember = forwardRole ? roster.find((m) => m.role === forwardRole) : null;

      const res = await fetch(`/api/documents/${token}/seal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: signaturePng,
          page: stampPos.page,
          cx: stampPos.cx,
          cy: stampPos.cy,
          widthFrac,
          decision,
          note: note.trim() || null,
          signerName: signerName.trim() || ORG_ROLE_LABELS[signerRole],
          signerEmail: signerEmail.trim() || `${signerRole}@signflow.org`,
          signerRole,
          forwardToRole: forwardRole,
          forwardToName: forwardMember?.name || (forwardRole ? ORG_ROLE_LABELS[forwardRole] : null),
          forwardToEmail: forwardMember?.email || (forwardRole ? `${forwardRole}@signflow.org` : null),
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
          setSignaturePng(null);
          setNote('');
          toast(`Stamped & sent to ${ORG_ROLE_LABELS[data.forwardedToRole as OrgRole]}!`, 'ok');
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
          authorName: signerName || ORG_ROLE_LABELS[signerRole],
          authorEmail: signerEmail || `${signerRole}@signflow.org`,
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
      <div className="card">
        <span className="row muted">
          <span className="spinner" /> Opening paper...
        </span>
      </div>
    );
  }

  const isDone = doc.status === 'completed' || doc.status === 'rejected';

  return (
    <div className="stack">
      {/* ── Clear Visual Progress Tracker: HR -> Director -> Boss -> Done ── */}
      <div className="card row-between" style={{ padding: '14px 20px' }}>
        <div className="row" style={{ gap: 10 }}>
          <code>{doc.refCode}</code>
          <strong style={{ fontSize: '1.05rem' }}>{doc.title}</strong>
          <span className="muted">·</span>
          <span className="badge badge-muted">Prepared by {ORG_ROLE_LABELS[doc.senderRole]}</span>
          <span>→</span>
          {doc.signatures.map((s, i) => (
            <span key={i} className="badge badge-ok">
              ✓ {ORG_ROLE_LABELS[s.actorRole]} Signed
            </span>
          ))}
          {!isDone ? (
            <span className="badge badge-warn">⏳ Waiting for {ORG_ROLE_LABELS[doc.assignedRole]}</span>
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

      <div className="grid-2">
        {/* ── Left: Paper Preview + Simple Team Chat ── */}
        <div className="stack">
          <div className="card stack">
            <div className="row-between">
              <h2>{isDone ? 'Signed Paper' : 'Click Anywhere on the Paper to Move Your Signature'}</h2>
              {!isDone && (
                <div className="seg">
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.25, cy: 0.82 })}>
                    Left
                  </button>
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.5, cy: 0.82 })}>
                    Center
                  </button>
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.75, cy: 0.82 })}>
                    Right
                  </button>
                </div>
              )}
            </div>

            <PdfCanvasViewer
              data={pdfBytes}
              page={page}
              onPageChange={setPage}
              interactive={!isDone && Boolean(signaturePng)}
              onPlace={(p, cx, cy) => setStampPos({ page: p, cx, cy })}
              stamp={
                !isDone && signaturePng
                  ? {
                      page: stampPos.page,
                      cx: stampPos.cx,
                      cy: stampPos.cy,
                      widthFrac,
                      png: signaturePng,
                      caption: `${ORG_ROLE_LABELS[signerRole].toUpperCase()} · ${DECISION_LABELS[decision].toUpperCase()}`,
                      captionColor: DECISION_HEX[decision],
                    }
                  : null
              }
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
                        <span className="badge badge-primary">{ORG_ROLE_LABELS[c.authorRole]}</span>
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
                placeholder={`Write a message to HR / Director / Boss as ${ORG_ROLE_LABELS[signerRole]}...`}
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
                      {ev.actorRole && <span className="badge badge-primary">{ORG_ROLE_LABELS[ev.actorRole]}</span>}
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

        {/* ── Right: Super Simple 3-Step Signing Panel ── */}
        <div className="stack sticky">
          {isDone ? (
            <div className="card card-hero stack">
              <h2>✓ Paper Completed</h2>
              <p className="muted small">
                Signed by {doc.signatures.map((s) => `${ORG_ROLE_LABELS[s.actorRole]} (${s.actorName})`).join(' → ')}.
              </p>
              <a className="btn btn-primary btn-lg btn-block" href={`/api/documents/${token}/file?type=final&download=1`}>
                Download Signed PDF
              </a>
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

              {/* 1. Who are you signing as? */}
              <div className="field">
                <span>1. Your Role</span>
                <div className="seg full">
                  {(['director', 'boss', 'hr', 'finance'] as OrgRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={signerRole === r ? 'active' : ''}
                      onClick={() => switchActiveRole(r)}
                    >
                      {ORG_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
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

              {/* 2. Draw or Type Signature */}
              <div className="field">
                <span>2. Your Signature (Draw, Type, or Photo)</span>
                <SignatureCreator allowPhoto defaultText={signerName} value={signaturePng} onChange={setSignaturePng} />
              </div>

              <label className="field">
                <span>Signature Size</span>
                <div className="range-row">
                  <input
                    type="range"
                    min={12}
                    max={45}
                    value={Math.round(widthFrac * 100)}
                    onChange={(e) => setWidthFrac(Number(e.target.value) / 100)}
                  />
                  <output>{Math.round(widthFrac * 100)}%</output>
                </div>
              </label>

              <label className="field">
                <span>Short Note (optional)</span>
                <input
                  className="input"
                  placeholder="Optional comment..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              {/* 3. Finish or Pass to Boss? */}
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
                    <button
                      type="button"
                      className={nextTarget === 'boss' ? 'active' : ''}
                      onClick={() => setNextTarget('boss')}
                    >
                      → Send Next to Boss
                    </button>
                    <button
                      type="button"
                      className={nextTarget === 'director' ? 'active' : ''}
                      onClick={() => setNextTarget('director')}
                    >
                      → Send to Director
                    </button>
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
                    ? `Stamp & Send Next to ${ORG_ROLE_LABELS[nextTarget]} →`
                    : `Stamp as ${ORG_ROLE_LABELS[signerRole]} & Complete ✓`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
