'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { PdfCanvasViewer } from '@/components/PdfCanvasViewer';
import { useAuth } from '@/components/AuthProvider';
import { QrCodeSvg } from '@/components/QrCodeSvg';
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
  const otpInputId = useId();
  const otpHintId = useId();
  const otpFormRef = useRef<HTMLFormElement | null>(null);

  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // OTP state (only used when doc.requireOtp === true)
  const [verified, setVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpErr, setOtpErr] = useState<string | null>(null);

  // Active signer identity & placement state
  const [page, setPage] = useState(0);
  const [stampPos, setStampPos] = useState<{ page: number; cx: number; cy: number } | null>(null);
  const [widthFrac, setWidthFrac] = useState(0.24);
  const [decision, setDecision] = useState<Decision>('approved');
  const [note, setNote] = useState('');
  const [signerRole, setSignerRole] = useState<OrgRole>('director');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);

  // Multi-step routing (e.g. Director stamps -> forwards to Boss for final stamp)
  const [forwardMode, setForwardMode] = useState(false);
  const [forwardRole, setForwardRole] = useState<OrgRole>('boss');
  const [forwardName, setForwardName] = useState('Khamla Vongsa (Boss / CEO)');
  const [forwardEmail, setForwardEmail] = useState('boss@signflow.org');

  // Seal state
  const [sealing, setSealing] = useState(false);
  const [sealErr, setSealErr] = useState<string | null>(null);
  const [sealedHash, setSealedHash] = useState<string | null>(null);

  // Live Team Chat state
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
        setVerified(pub.sessionVerified);
        setSignerRole(pub.assignedRole || 'director');
        setSignerName(pub.signer2Name || '');
        setSignerEmail(pub.signer2Email || '');
        if (pub.finalSha256) setSealedHash(pub.finalSha256);

        if (teamRes && teamRes.ok) {
          const tData = await teamRes.json();
          if (tData?.roster?.length) {
            const rList = tData.roster as TeamMember[];
            setRoster(rList);
            const bossMember = rList.find((m) => m.role === 'boss');
            if (bossMember) {
              setForwardName(bossMember.name);
              setForwardEmail(bossMember.email);
            }
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

  const switchForwardRole = (role: OrgRole) => {
    setForwardRole(role);
    const match = roster.find((m) => m.role === role);
    if (match) {
      setForwardName(match.name);
      setForwardEmail(match.email);
    }
  };

  const sendOtp = async () => {
    setOtpBusy(true);
    setOtpErr(null);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/documents/${token}/otp/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code.');
      setOtpSent(true);
      setDevCode(data.devCode ?? null);
      setOtpMsg(`6-digit code sent to ${data.maskedEmail || 'your email'} (valid 10 minutes).`);
      toast('6-digit verification code sent', 'info');
    } catch (err) {
      setOtpErr(err instanceof Error ? err.message : 'Could not send code.');
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtpCode = async (codeToVerify: string) => {
    if (codeToVerify.length !== 6) return;
    setOtpBusy(true);
    setOtpErr(null);
    try {
      const res = await fetch(`/api/documents/${token}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToVerify }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed.');
      setVerified(true);
      setStampPos((prev) => prev ?? { page, cx: 0.72, cy: 0.82 });
      toast('Identity verified! Signature tools unlocked.', 'ok');
    } catch (err) {
      setOtpErr(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyOtpCode(otpCode);
  };

  const sealDocument = async () => {
    if (!signaturePng) return setSealErr('Create your signature (Draw, Type or Photo Scan).');
    if (!stampPos) return setSealErr('Click anywhere on the PDF page to position your signature stamp.');
    if (decision === 'approved_with_notes' && !note.trim()) return setSealErr('Add a note for "Approved w/ Notes".');

    setSealing(true);
    setSealErr(null);
    try {
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
          signerName: signerName.trim() || null,
          signerEmail: signerEmail.trim() || null,
          signerRole,
          forwardToRole: forwardMode && decision !== 'rejected' ? forwardRole : null,
          forwardToName: forwardMode && decision !== 'rejected' ? forwardName : null,
          forwardToEmail: forwardMode && decision !== 'rejected' ? forwardEmail : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to seal document.');
      setSealedHash(data.finalSha256);
      if (data.document) {
        const updated = data.document as PublicDocument;
        setDoc(updated);
        if (data.forwardedToRole) {
          switchActiveRole(data.forwardedToRole as OrgRole);
          setForwardMode(false);
          setSignaturePng(null);
          setNote('');
          toast(`Stamped & forwarded to ${ORG_ROLE_LABELS[data.forwardedToRole as OrgRole]}!`, 'ok');
        } else {
          toast(`Document finalized & sealed (${DECISION_LABELS[decision]})`, 'ok');
        }
      }

      const finalRes = await fetch(`/api/documents/${token}/file?t=${Date.now()}`, { cache: 'no-store' });
      if (finalRes.ok) {
        const bytes = new Uint8Array(await finalRes.arrayBuffer());
        setPdfBytes(bytes);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSealErr(err instanceof Error ? err.message : 'Failed to seal document.');
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
      toast('Message posted to document thread', 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send message', 'err');
    } finally {
      setChatBusy(false);
    }
  };

  const copyHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    toast('SHA-256 fingerprint copied', 'ok');
  };

  if (loadErr) {
    return (
      <div className="card stack">
        <h2>Unable to open signing link</h2>
        <div className="alert alert-danger">{loadErr}</div>
        <div className="row">
          <Link href="/team" className="btn btn-primary">
            Open Team Hub
          </Link>
          <Link href="/sign" className="btn">
            Back to Review &amp; Co-Sign
          </Link>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="card">
        <span className="row muted">
          <span className="spinner" /> Loading signing workspace...
        </span>
      </div>
    );
  }

  const isDone = doc.status === 'completed' || doc.status === 'rejected';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="badge badge-primary">{doc.refCode}</span>
            <span className="badge badge-muted">From: {ORG_ROLE_LABELS[doc.senderRole]}</span>
            <span className="badge badge-primary">Current Turn: {ORG_ROLE_LABELS[doc.assignedRole]}</span>
            {doc.status === 'completed' && <span className="badge badge-ok">✓ Completed &amp; Sealed</span>}
            {doc.status === 'rejected' && <span className="badge badge-danger">✕ Rejected &amp; Sealed</span>}
            {doc.status === 'pending_cosign' && <span className="badge badge-warn">Awaiting Signature</span>}
            {!doc.requireOtp && <span className="badge badge-ok">⚡ Instant Internal Sign (No OTP)</span>}
          </div>
          <h1>{doc.title}</h1>
          <p>
            Prepared by <strong>{doc.signer1Name || doc.signer1Email || 'HR'}</strong> · Currently assigned to{' '}
            <strong>
              {ORG_ROLE_LABELS[doc.assignedRole]} ({doc.signer2Name || doc.signer2Email || doc.signer2EmailMasked})
            </strong>
          </p>
        </div>
        <div className="row">
          <Link className="btn" href="/team">
            Team Hub &amp; Traceability
          </Link>
          {isDone && (
            <>
              <a className="btn btn-primary" href={`/api/documents/${token}/file?type=final&download=1`}>
                Download Sealed PDF
              </a>
              <Link className="btn" href="/verify">
                Verify PDF →
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Traceable Signature Chain Banner ── */}
      {doc.signatures.length > 0 && (
        <div className="card stack">
          <div className="row-between">
            <h2>Traceable Signature Chain ({doc.signatures.length} Stamp{doc.signatures.length > 1 ? 's' : ''} Applied)</h2>
            <span className="badge badge-ok">Original Background 100% Preserved</span>
          </div>
          <div className="stack-sm">
            {doc.signatures.map((s, idx) => (
              <div
                key={idx}
                className="row-between"
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="row">
                  <span className="badge badge-primary">#{idx + 1} · {ORG_ROLE_LABELS[s.actorRole]}</span>
                  <strong>{s.actorName}</strong>
                  <span className="small muted">({s.actorEmail})</span>
                  <span
                    className={`badge ${
                      s.decision === 'rejected'
                        ? 'badge-danger'
                        : s.decision === 'approved_with_notes'
                          ? 'badge-warn'
                          : 'badge-ok'
                    }`}
                  >
                    {DECISION_LABELS[s.decision]} on Page {s.page}
                  </span>
                </div>
                <div className="small muted mono">
                  {new Date(s.signedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC · IP {s.ipAddress}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isDone && (
        <div className="card card-hero stack">
          <div className="row-between">
            <div>
              <h2>✓ Document Sealed (Original Pages Only — No Extra Pages Added)</h2>
              <p className="muted small">
                All transparent signature stamps are embedded directly over the original document background.
              </p>
            </div>
            <div className="row">
              <a className="btn btn-primary btn-sm" href={`/api/documents/${token}/file?type=final&download=1`}>
                Download Sealed PDF
              </a>
              <Link className="btn btn-sm" href="/team">
                Open Team Hub
              </Link>
            </div>
          </div>
          {sealedHash && (
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>
                Final SHA-256 Fingerprint (registered in Supabase ledger)
              </div>
              <div className="hash-box">
                <span>{sealedHash}</span>
                <button type="button" className="btn btn-sm" onClick={() => copyHash(sealedHash)}>
                  Copy Hash
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid-2">
        {/* ── Left column: PDF canvas preview + Live Team Chat & Audit History ── */}
        <div className="stack">
          <div className="card stack">
            <div className="row-between">
              <h2>{isDone ? 'Sealed PDF Preview' : 'Interactive Document Preview'}</h2>
              {!isDone && verified && (
                <span className="badge badge-primary">
                  {stampPos
                    ? `Stamp on page ${stampPos.page + 1} (click page or drag stamp)`
                    : 'Click anywhere on the page to place stamp'}
                </span>
              )}
            </div>
            <PdfCanvasViewer
              data={pdfBytes}
              page={page}
              onPageChange={setPage}
              interactive={!isDone && verified && Boolean(signaturePng)}
              onPlace={(p, cx, cy) => setStampPos({ page: p, cx, cy })}
              stamp={
                !isDone && verified && signaturePng && stampPos
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

          {/* ── Live Organization Discussion (HR ↔ Director ↔ Boss) ── */}
          <div className="card stack">
            <div className="row-between">
              <div>
                <h2>Team Discussion (HR ↔ Director ↔ Boss)</h2>
                <p className="muted small">
                  Communicate directly on this document — every message is recorded in the audit timeline.
                </p>
              </div>
              <span className="badge badge-primary">{doc.comments.length} message(s)</span>
            </div>

            {doc.comments.length === 0 ? (
              <div className="small muted" style={{ padding: '10px 0' }}>
                No team messages yet. Start the conversation below (e.g. &ldquo;@Director please check clause 3 before
                forwarding to Boss&rdquo;).
              </div>
            ) : (
              <div className="stack-sm">
                {doc.comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="row-between" style={{ marginBottom: 4 }}>
                      <div className="row">
                        <span className="badge badge-primary">{ORG_ROLE_LABELS[c.authorRole]}</span>
                        <strong>{c.authorName}</strong>
                        <span className="small muted">{c.authorEmail}</span>
                      </div>
                      <span className="small muted mono">
                        {new Date(c.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
                      </span>
                    </div>
                    <p style={{ fontSize: '0.92rem' }}>{c.message}</p>
                  </div>
                ))}
              </div>
            )}

            <form className="copy-field" onSubmit={postComment}>
              <input
                className="input"
                placeholder={`Message as ${ORG_ROLE_LABELS[signerRole]} (${signerName || signerEmail || 'Team'})...`}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={chatBusy || !chatText.trim()}>
                {chatBusy ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>

          {/* ── Live Traceable Audit Log ── */}
          <div className="card stack">
            <div className="row-between">
              <h2>Full Traceable History Log ({doc.events.length})</h2>
              <span className="badge badge-muted">Who · Which Role · IP · UTC Time</span>
            </div>
            <ul className="timeline">
              {doc.events.map((ev, i) => (
                <li key={i} className={ev.type}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="t-title">{ev.label}</span>
                    {ev.actorRole && <span className="badge badge-primary">{ORG_ROLE_LABELS[ev.actorRole]}</span>}
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
          </div>
        </div>

        {/* ── Right column: Role Switcher + Sign & Forward / Final Seal Controls ── */}
        <div className="stack sticky">
          {!isDone && !verified && doc.requireOtp && (
            <div className="card stack">
              <div className="row-between">
                <h2>Email OTP Verification</h2>
                <span className="badge badge-warn">External OTP Gate</span>
              </div>
              <p className="muted small">
                This document requires a 6-digit verification code sent to <strong>{doc.signer2EmailMasked}</strong>.
              </p>
              <button type="button" className="btn btn-primary btn-block" disabled={otpBusy} onClick={sendOtp}>
                {otpBusy
                  ? 'Sending code...'
                  : otpSent
                    ? 'Resend 6-Digit Verification Code'
                    : 'Send 6-Digit Verification Code'}
              </button>

              {otpMsg && <div className="alert alert-info">{otpMsg}</div>}
              {devCode && (
                <div className="alert alert-warn row-between">
                  <span>
                    Demo mode code: <strong className="mono">{devCode}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setOtpCode(devCode);
                      verifyOtpCode(devCode);
                    }}
                  >
                    Auto-Fill &amp; Verify
                  </button>
                </div>
              )}
              {otpErr && <div className="alert alert-danger">{otpErr}</div>}

              {otpSent && (
                <form ref={otpFormRef} className="stack" method="POST" onSubmit={verifyOtp}>
                  <div className="field">
                    <label htmlFor={otpInputId} style={{ fontSize: '0.8rem', fontWeight: 620 }}>
                      Enter 6-Digit Verification Code
                    </label>
                    <p id={otpHintId} className="field-hint">
                      Type or paste the 6-digit code sent to {doc.signer2EmailMasked}.
                    </p>
                    <label className="otp-slot-wrap" htmlFor={otpInputId}>
                      <div className="otp-slots" aria-hidden>
                        {Array.from({ length: 6 }, (_, i) => {
                          const ch = otpCode[i] ?? '';
                          const isActive = i === Math.min(otpCode.length, 5);
                          return (
                            <div key={i} className={`otp-slot ${ch ? 'filled' : ''} ${isActive ? 'active' : ''}`}>
                              {ch}
                            </div>
                          );
                        })}
                      </div>
                      <input
                        id={otpInputId}
                        name="otp"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="\d{6}"
                        maxLength={6}
                        aria-describedby={otpHintId}
                        required
                        className="otp-real-input"
                        value={otpCode}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setOtpCode(next);
                          if (next.length === 6) verifyOtpCode(next);
                        }}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={otpBusy || otpCode.length !== 6}
                  >
                    Verify Code &amp; Unlock Signing
                  </button>
                </form>
              )}
            </div>
          )}

          {!isDone && verified && (
            <div className="card stack">
              <div className="row-between">
                <h2>Sign as Organization Role</h2>
                {user ? (
                  <span className="badge badge-ok">
                    ✓ Signed in: {ORG_ROLE_LABELS[user.role]}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openAuthModal('login', { email: signerEmail, name: signerName, role: signerRole })}
                  >
                    Sign In / Create Account
                  </button>
                )}
              </div>

              <div className="field">
                <span>Your Role in Organization</span>
                <div className="seg full">
                  {(['hr', 'director', 'boss', 'finance'] as OrgRole[]).map((r) => (
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

              {roster.length > 0 && (
                <label className="field">
                  <span>Quick-Select Team Member Identity</span>
                  <select
                    className="select"
                    value={signerEmail}
                    onChange={(e) => {
                      const m = roster.find((x) => x.email === e.target.value);
                      if (m) {
                        setSignerRole(m.role);
                        setSignerName(m.name);
                        setSignerEmail(m.email);
                      }
                    }}
                  >
                    {roster.map((m) => (
                      <option key={m.id} value={m.email}>
                        {ORG_ROLE_LABELS[m.role]} — {m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="fields-2">
                <label className="field">
                  <span>Your Name</span>
                  <input
                    className="input"
                    placeholder="Somsack (Director)"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Your Email</span>
                  <input
                    className="input"
                    type="email"
                    placeholder="director@signflow.org"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                  />
                </label>
              </div>

              <div className="field">
                <span>Decision</span>
                <div className="decisions">
                  {(['approved', 'approved_with_notes', 'rejected'] as Decision[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`decision ${d} ${decision === d ? 'active' : ''}`}
                      onClick={() => setDecision(d)}
                    >
                      {DECISION_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <span>Note / Comment {decision === 'approved_with_notes' ? '(required)' : '(optional)'}</span>
                <textarea
                  className="textarea"
                  placeholder="e.g. Checked by Director, forwarding to Boss for final approval..."
                  value={note}
                  maxLength={600}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Your Signature Stamp (Draw, Type, or Photo Scan)</span>
                <SignatureCreator
                  allowPhoto
                  defaultText={signerName}
                  value={signaturePng}
                  onChange={(png) => {
                    setSignaturePng(png);
                    if (png && !stampPos) {
                      // Offset stamp position automatically if previous signers already stamped
                      const offset = doc.signatures.length;
                      const cx = offset === 0 ? 0.3 : offset === 1 ? 0.72 : 0.5;
                      setStampPos({ page, cx, cy: 0.82 });
                    }
                  }}
                />
              </div>

              <label className="field">
                <span>Stamp Size on Page</span>
                <div className="range-row">
                  <input
                    type="range"
                    min={10}
                    max={50}
                    value={Math.round(widthFrac * 100)}
                    onChange={(e) => setWidthFrac(Number(e.target.value) / 100)}
                  />
                  <output>{Math.round(widthFrac * 100)}%</output>
                </div>
              </label>

              <div className="field">
                <span>Quick Stamp Placement (Page {page + 1})</span>
                <div className="seg full">
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.24, cy: 0.82 })}>
                    Bottom-Left (HR/Dir)
                  </button>
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.5, cy: 0.82 })}>
                    Bottom-Center
                  </button>
                  <button type="button" onClick={() => setStampPos({ page, cx: 0.76, cy: 0.82 })}>
                    Bottom-Right (Boss)
                  </button>
                </div>
              </div>

              {decision !== 'rejected' && (
                <div className="stack-sm">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={forwardMode}
                      onChange={(e) => setForwardMode(e.target.checked)}
                    />
                    <span>Stamp &amp; Forward to Next Approver (e.g. Director → Boss) before final lock</span>
                  </label>

                  {forwardMode && (
                    <div
                      className="stack-sm"
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span className="small muted" style={{ fontWeight: 600 }}>
                        Forward Next To:
                      </span>
                      <div className="seg full">
                        {(['boss', 'director', 'hr', 'finance'] as OrgRole[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={forwardRole === r ? 'active' : ''}
                            onClick={() => switchForwardRole(r)}
                          >
                            {ORG_ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                      <div className="fields-2">
                        <input
                          className="input"
                          placeholder="Next Signer Name"
                          value={forwardName}
                          onChange={(e) => setForwardName(e.target.value)}
                        />
                        <input
                          className="input"
                          type="email"
                          placeholder="boss@signflow.org"
                          value={forwardEmail}
                          onChange={(e) => setForwardEmail(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {sealErr && <div className="alert alert-danger">{sealErr}</div>}

              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={sealing}
                onClick={sealDocument}
              >
                {sealing ? (
                  <>
                    <span className="spinner" /> Stamping PDF...
                  </>
                ) : forwardMode && decision !== 'rejected' ? (
                  `Stamp as ${ORG_ROLE_LABELS[signerRole]} & Forward to ${ORG_ROLE_LABELS[forwardRole]}`
                ) : (
                  `Stamp as ${ORG_ROLE_LABELS[signerRole]} & Finalize PDF`
                )}
              </button>
            </div>
          )}

          <div className="card stack">
            <div className="row-between">
              <h3>Document Ledger Info</h3>
              <span className="badge badge-muted">SHA-256</span>
            </div>
            <dl className="kv small">
              <dt>Reference</dt>
              <dd>
                <code>{doc.refCode}</code>
              </dd>
              <dt>Prepared By</dt>
              <dd>
                {ORG_ROLE_LABELS[doc.senderRole]} · {doc.signer1Name || doc.signer1Email || '—'}
              </dd>
              <dt>Assigned To</dt>
              <dd>
                {ORG_ROLE_LABELS[doc.assignedRole]} · {doc.signer2Name || doc.signer2Email || '—'}
              </dd>
              <dt>Stamps Applied</dt>
              <dd>{doc.signatures.length}</dd>
              <dt>Stage-1 Hash</dt>
              <dd className="mono">{doc.stage1Sha256?.slice(0, 22)}...</dd>
              {doc.finalSha256 && (
                <>
                  <dt>Latest Hash</dt>
                  <dd className="mono">{doc.finalSha256.slice(0, 22)}...</dd>
                </>
              )}
            </dl>
            {typeof window !== 'undefined' && (
              <div className="row" style={{ justifyContent: 'center', paddingTop: 4 }}>
                <QrCodeSvg value={window.location.href} size={96} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
