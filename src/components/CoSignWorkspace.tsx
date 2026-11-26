'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { PdfCanvasViewer } from '@/components/PdfCanvasViewer';
import { QrCodeSvg } from '@/components/QrCodeSvg';
import { SignatureCreator } from '@/components/SignatureCreator';
import { useToast } from '@/components/Toast';
import { DECISION_LABELS, type Decision, type PublicDocument } from '@/lib/types';

const DECISION_HEX: Record<Decision, string> = {
  approved: '#15803d',
  approved_with_notes: '#b45309',
  rejected: '#dc2626',
};

export function CoSignWorkspace({ token }: { token: string }) {
  const { toast } = useToast();
  const otpInputId = useId();
  const otpHintId = useId();
  const otpFormRef = useRef<HTMLFormElement | null>(null);

  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // OTP state
  const [verified, setVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpErr, setOtpErr] = useState<string | null>(null);

  // Placement state
  const [page, setPage] = useState(0);
  const [stampPos, setStampPos] = useState<{ page: number; cx: number; cy: number } | null>(null);
  const [widthFrac, setWidthFrac] = useState(0.24);
  const [decision, setDecision] = useState<Decision>('approved');
  const [note, setNote] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);

  // Seal state
  const [sealing, setSealing] = useState(false);
  const [sealErr, setSealErr] = useState<string | null>(null);
  const [sealedHash, setSealedHash] = useState<string | null>(null);

  const viewedLogged = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/documents/${token}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Document not found.');
        if (cancelled) return;
        const pub = data as PublicDocument;
        setDoc(pub);
        setVerified(pub.sessionVerified);
        setSignerName(pub.signer2Name || '');
        if (pub.finalSha256) setSealedHash(pub.finalSha256);

        if (!viewedLogged.current) {
          viewedLogged.current = true;
          fetch(`/api/documents/${token}/view`, { method: 'POST' }).catch(() => undefined);
        }

        const which = pub.status === 'completed' || pub.status === 'rejected' ? 'final' : 'original';
        const pdfRes = await fetch(`/api/documents/${token}/file?type=${which}`, { cache: 'no-store' });
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to seal document.');
      setSealedHash(data.finalSha256);
      setDoc((prev) => (prev ? { ...prev, status: data.status, finalSha256: data.finalSha256, decision } : prev));
      toast(`Document sealed (${DECISION_LABELS[decision]})`, 'ok');

      const finalRes = await fetch(`/api/documents/${token}/file?type=final`, { cache: 'no-store' });
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
          <span className="spinner" /> Loading signing request...
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
            {doc.status === 'completed' && <span className="badge badge-ok">✓ Completed &amp; Sealed</span>}
            {doc.status === 'rejected' && <span className="badge badge-danger">✕ Rejected &amp; Sealed</span>}
            {doc.status === 'pending_cosign' && <span className="badge badge-warn">Awaiting Co-Signature</span>}
          </div>
          <h1>{doc.title}</h1>
          <p>
            Prepared by <strong>{doc.signer1Name || doc.signer1Email || 'Sender'}</strong> · Co-signer{' '}
            <strong>{doc.signer2Name || doc.signer2EmailMasked}</strong>
          </p>
        </div>
        {isDone && (
          <div className="row">
            <a className="btn btn-primary" href={`/api/documents/${token}/file?type=final&download=1`}>
              Download Sealed PDF
            </a>
            <Link className="btn" href="/verify">
              Verify PDF &amp; Audit Trail →
            </Link>
          </div>
        )}
      </div>

      {isDone && (
        <div className="card card-hero stack">
          <div className="row-between">
            <div>
              <h2>✓ Document Sealed (Original Pages Only — No Extra Pages Added)</h2>
              <p className="muted small">
                Your transparent signature stamp is embedded directly over the page background. The full audit trail &amp;
                verification history are stored in the SignFlow ledger (view anytime under <strong>Verify PDF</strong>).
              </p>
            </div>
            <div className="row">
              <a className="btn btn-primary btn-sm" href={`/api/documents/${token}/file?type=final&download=1`}>
                Download Sealed PDF
              </a>
              <Link className="btn btn-sm" href="/verify">
                View Audit Trail
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
        {/* ── PDF canvas preview ── */}
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
                    caption: DECISION_LABELS[decision].toUpperCase(),
                    captionColor: DECISION_HEX[decision],
                  }
                : null
            }
          />
        </div>

        {/* ── Gate + co-sign controls ── */}
        <div className="stack sticky">
          {!isDone && !verified && (
            <div className="card stack">
              <div className="row-between">
                <h2>Email OTP Verification</h2>
                <span className="badge badge-warn">Security Gate</span>
              </div>
              <p className="muted small">
                To verify your identity and record an auditable signature, click below to send a 6-digit verification code to{' '}
                <strong>{doc.signer2EmailMasked}</strong>.
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
                    <label htmlFor={otpInputId} style={{ fontSize: '0.8rem', fontWeight: 620, color: '#334155' }}>
                      Enter 6-Digit Verification Code
                    </label>
                    <p id={otpHintId} className="field-hint">
                      Type or paste the 6-digit code sent to {doc.signer2EmailMasked}.
                    </p>
                    {/* Single semantic input styled as 6 visual digit slots (preserves autocomplete="one-time-code" & paste) */}
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
                <h2>Co-Sign &amp; Seal</h2>
                <span className="badge badge-ok">✓ OTP Verified</span>
              </div>

              <label className="field">
                <span>Your Full Name</span>
                <input
                  className="input"
                  placeholder="Jordan Lee"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
              </label>

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
                <span>Note {decision === 'approved_with_notes' ? '(required)' : '(optional)'}</span>
                <textarea
                  className="textarea"
                  placeholder="Add review notes or conditions..."
                  value={note}
                  maxLength={600}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Your Signature (Draw, Type, or Photo Scan)</span>
                <SignatureCreator
                  allowPhoto
                  defaultText={signerName}
                  value={signaturePng}
                  onChange={(png) => {
                    setSignaturePng(png);
                    if (png && !stampPos) setStampPos({ page, cx: 0.72, cy: 0.82 });
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
                  <button
                    type="button"
                    onClick={() => setStampPos({ page, cx: 0.24, cy: 0.82 })}
                  >
                    Bottom-Left
                  </button>
                  <button
                    type="button"
                    onClick={() => setStampPos({ page, cx: 0.5, cy: 0.82 })}
                  >
                    Bottom-Center
                  </button>
                  <button
                    type="button"
                    onClick={() => setStampPos({ page, cx: 0.76, cy: 0.82 })}
                  >
                    Bottom-Right
                  </button>
                </div>
              </div>

              {sealErr && <div className="alert alert-danger">{sealErr}</div>}

              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={sealing}
                onClick={sealDocument}
              >
                {sealing ? (
                  <>
                    <span className="spinner" /> Sealing &amp; Stamping PDF...
                  </>
                ) : (
                  'Seal & Lock Final PDF'
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
              <dt>Stage-1 Hash</dt>
              <dd className="mono">{doc.stage1Sha256?.slice(0, 22)}...</dd>
              {doc.finalSha256 && (
                <>
                  <dt>Final Hash</dt>
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
