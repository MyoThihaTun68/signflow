'use client';

import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { downloadBytes } from '@/lib/client/buildPdf';
import { formatBytes } from '@/lib/client/image';
import { sha256Hex } from '@/lib/client/sha256';
import { roleLabel, type VerifyResult } from '@/lib/types';

const SAMPLE_VERIFIED_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const SAMPLE_VERIFIED_RESULT: VerifyResult = {
  status: 'verified',
  stage: 'final',
  refCode: 'SF-849201',
  title: 'Master Service & NDA Agreement (Sample)',
  documentStatus: 'completed',
  signer1Name: 'Noy Chanthavong (HR)',
  signer2Name: 'Khamla Vongsa (Boss)',
  createdAt: new Date(Date.now() - 3600_000 * 3).toISOString(),
  completedAt: new Date(Date.now() - 1800_000).toISOString(),
  sha256: SAMPLE_VERIFIED_HASH,
  events: [
    {
      type: 'created',
      label: 'Created',
      actorName: 'Noy Chanthavong',
      actorRole: 'hr',
      actorEmail: 'hr@signflow.org',
      ipAddress: '103.43.112.18',
      userAgent: 'SignFlow Web Scanner',
      createdAt: new Date(Date.now() - 3600_000 * 3).toISOString(),
    },
    {
      type: 'signed',
      label: 'Director Signed (APPROVED)',
      actorName: 'Somsack Phomvihane',
      actorRole: 'director',
      actorEmail: 'director@signflow.org',
      ipAddress: '103.43.112.24',
      userAgent: 'Safari / iOS',
      createdAt: new Date(Date.now() - 3600_000 * 2).toISOString(),
    },
    {
      type: 'signed',
      label: 'Boss Signed (APPROVED)',
      actorName: 'Khamla Vongsa',
      actorRole: 'boss',
      actorEmail: 'boss@signflow.org',
      ipAddress: '103.43.112.41',
      userAgent: 'Chrome / macOS',
      createdAt: new Date(Date.now() - 1800_000).toISOString(),
    },
    {
      type: 'completed',
      label: 'Completed & Sealed',
      actorName: 'Khamla Vongsa',
      actorRole: 'boss',
      actorEmail: 'boss@signflow.org',
      ipAddress: '103.43.112.41',
      userAgent: 'SignFlow Ledger',
      createdAt: new Date(Date.now() - 1795_000).toISOString(),
    },
  ],
};

function extractRefCode(bytes: Uint8Array, fileName: string): string | null {
  const fromName = fileName.match(/\b(SF-\d{6})\b/);
  if (fromName) return fromName[1];
  const sample = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 400_000)));
  const m = sample.match(/\b(SF-\d{6})\b/);
  return m ? m[1] : null;
}

export default function VerifyPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualHash, setManualHash] = useState('');
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; refHint: string | null } | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryHash = async (
    sha256: string,
    refCode: string | null,
    info: { name: string; size: number; refHint: string | null },
  ) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileInfo(info);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256, refCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification request failed.');
      const ver = data as VerifyResult;
      setResult(ver);
      if (ver.status === 'verified') toast(`Verified: ${ver.refCode} is authentic`, 'ok');
      else if (ver.status === 'tampered') toast(`Tampered: hash mismatch for ${ver.refCode}`, 'err');
      else toast('Unregistered SHA-256 fingerprint', 'warn');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify file.');
    } finally {
      setBusy(false);
    }
  };

  const checkFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha256 = await sha256Hex(bytes);
      setManualHash(sha256);
      const refCode = extractRefCode(bytes, file.name);
      await queryHash(sha256, refCode, { name: file.name, size: file.size, refHint: refCode });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not read file.');
    }
  };

  const checkManualHash = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleaned)) {
      setError('Enter a valid 64-character hexadecimal SHA-256 hash.');
      return;
    }
    if (cleaned === SAMPLE_VERIFIED_HASH) {
      setError(null);
      setFileInfo({ name: 'Sample-Master-Service-Agreement.pdf', size: 184_320, refHint: 'SF-849201' });
      setResult(SAMPLE_VERIFIED_RESULT);
      toast('Sample verified ledger match loaded!', 'ok');
      return;
    }
    await queryHash(cleaned, null, { name: 'Direct SHA-256 Lookup', size: 0, refHint: null });
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setManualHash(text);
        setError(null);
        toast('Pasted from clipboard', 'info');
      } else {
        toast('Clipboard is empty', 'warn');
      }
    } catch {
      toast('Allow clipboard permission or press Ctrl+V', 'warn');
    }
  };

  const trySampleVerifiedHash = () => {
    setManualHash(SAMPLE_VERIFIED_HASH);
    setError(null);
    setFileInfo({ name: 'Sample-Master-Service-Agreement.pdf', size: 184_320, refHint: 'SF-849201' });
    setResult(SAMPLE_VERIFIED_RESULT);
    toast('Demonstrating verified ledger match (SF-849201)', 'ok');
  };

  const exportAuditJson = () => {
    if (!result || result.status !== 'verified') return;
    const payload = JSON.stringify(result, null, 2);
    downloadBytes(new TextEncoder().encode(payload), `${result.refCode}-audit-report.json`, 'application/json');
    toast('Downloaded JSON audit report', 'ok');
  };

  const copyHash = async (h: string) => {
    await navigator.clipboard.writeText(h);
    toast('SHA-256 copied to clipboard', 'ok');
  };

  return (
    <div className="focal-3xl stack">
      {/* ── Crisp Centered Header ── */}
      <div className="verify-head">
        <h1>Verify PDF</h1>
        <p className="muted">
          Compute a live SHA-256 fingerprint directly in your browser via <code>crypto.subtle.digest</code> and check
          authenticity against the SignFlow ledger.
        </p>
      </div>

      {/* ── Unified Verification Card with Clean OR Divider ── */}
      <div className="card verify-card stack" data-tour="verify-card">
        <div
          className={`dropzone verify-dropzone ${drag ? 'drag' : ''} ${busy ? 'scan-beam' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            checkFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="dropzone-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Zm-2.5 9 2 2 4-4" />
            </svg>
          </div>
          <strong>
            {busy ? 'Computing SHA-256 & querying ledger...' : 'Drop a PDF here to verify its authenticity'}
          </strong>
          <span className="muted">
            Zero-knowledge check — your PDF stays on this device; only its 64-character SHA-256 digest is queried.
          </span>
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse PDF File
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => checkFile(e.target.files?.[0])}
          />
        </div>

        {/* Clean OR Divider */}
        <div className="or-divider" role="separator">
          <span>OR</span>
        </div>

        {/* Direct SHA-256 Input with Integrated One-Click Paste */}
        <div className="stack-sm">
          <div className="row-between">
            <span className="small" style={{ fontWeight: 630 }}>
              Verify by SHA-256 Fingerprint Directly
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--primary)' }}
              onClick={trySampleVerifiedHash}
            >
              ✦ Try sample verified hash
            </button>
          </div>

          <form className="hash-input-form" onSubmit={checkManualHash}>
            <div className="input-with-action">
              <input
                className="input mono"
                placeholder="Paste 64-character SHA-256 hex digest..."
                value={manualHash}
                onChange={(e) => {
                  setManualHash(e.target.value);
                  setError(null);
                }}
              />
              <button
                type="button"
                className="input-inline-btn"
                onClick={pasteFromClipboard}
                title="Paste SHA-256 hash from clipboard"
              >
                Paste
              </button>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Verify Hash
            </button>
          </form>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
      </div>

      {/* ── Verification Result & Full Audit Timeline ── */}
      {result && fileInfo && (
        <div className="stack">
          {result.status === 'verified' && (
            <div className="verdict ok">
              <div className="verdict-icon">✓</div>
              <div className="stack" style={{ flex: 1 }}>
                <div className="row-between">
                  <h2>VERIFIED — Authentic &amp; Unmodified</h2>
                  <div className="row">
                    <span className="badge badge-ok">
                      {result.stage === 'final' ? 'Final Sealed PDF' : 'Stage-1 Original PDF'}
                    </span>
                    <button type="button" className="btn btn-sm" onClick={exportAuditJson}>
                      Export JSON
                    </button>
                  </div>
                </div>
                <p className="muted">
                  <strong>{fileInfo.name}</strong>
                  {fileInfo.size ? ` (${formatBytes(fileInfo.size)})` : ''} matches registered SignFlow document{' '}
                  <code>{result.refCode}</code> byte-for-byte.
                </p>
                <div className="hash-box">
                  <span>{result.sha256}</span>
                  <button type="button" className="btn btn-sm" onClick={() => copyHash(result.sha256)}>
                    Copy Hash
                  </button>
                </div>
              </div>
            </div>
          )}

          {result.status === 'tampered' && (
            <div className="verdict bad">
              <div className="verdict-icon">!</div>
              <div className="stack" style={{ flex: 1 }}>
                <h2>TAMPERED — Hash Mismatch</h2>
                <p>
                  This file references <strong>{result.title}</strong> (<code>{result.refCode}</code>), but its SHA-256
                  digest does not match either the registered Stage-1 original or the sealed final file.
                </p>
                <div className="hash-box">
                  <span>{result.sha256}</span>
                  <button type="button" className="btn btn-sm" onClick={() => copyHash(result.sha256)}>
                    Copy Hash
                  </button>
                </div>
              </div>
            </div>
          )}

          {result.status === 'unregistered' && (
            <div className="verdict unknown">
              <div className="verdict-icon">?</div>
              <div className="stack" style={{ flex: 1 }}>
                <h2>UNREGISTERED</h2>
                <p className="muted">
                  No document with this SHA-256 fingerprint exists in the SignFlow ledger. Either the file was not
                  created by this SignFlow instance, or it was modified after export.
                </p>
                <div className="hash-box">
                  <span>{result.sha256}</span>
                  <button type="button" className="btn btn-sm" onClick={() => copyHash(result.sha256)}>
                    Copy Hash
                  </button>
                </div>
              </div>
            </div>
          )}

          {result.status === 'verified' && (
            <div className="card stack">
              <div className="row-between">
                <h2>Document Record &amp; Audit Timeline</h2>
                <span className="badge badge-primary">{result.refCode}</span>
              </div>
              <dl className="kv">
                <dt>Title</dt>
                <dd>{result.title}</dd>
                <dt>Status</dt>
                <dd>
                  <span className={`badge ${result.documentStatus === 'completed' ? 'badge-ok' : 'badge-warn'}`}>
                    {result.documentStatus}
                  </span>
                </dd>
                <dt>Prepared By</dt>
                <dd>{result.signer1Name || '—'}</dd>
                <dt>Signed By</dt>
                <dd>{result.signer2Name || '—'}</dd>
                <dt>Completed (UTC)</dt>
                <dd>
                  {result.completedAt
                    ? `${new Date(result.completedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
                    : '—'}
                </dd>
              </dl>

              <hr className="divider" />

              <ul className="timeline">
                {result.events.map((ev, i) => (
                  <li key={i} className={ev.type}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="t-title">{ev.label}</span>
                      {ev.actorRole && <span className="badge badge-primary">{roleLabel(ev.actorRole)}</span>}
                    </div>
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
          )}
        </div>
      )}
    </div>
  );
}
