'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { downloadBytes } from '@/lib/client/buildPdf';
import { formatBytes } from '@/lib/client/image';
import { sha256Hex } from '@/lib/client/sha256';
import type { VerifyResult } from '@/lib/types';

function extractRefCode(bytes: Uint8Array, fileName: string): string | null {
  const fromName = fileName.match(/\b(SF-\d{6})\b/);
  if (fromName) return fromName[1];
  const sample = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 400_000)));
  const m = sample.match(/\b(SF-\d{6})\b/);
  return m ? m[1] : null;
}

export default function VerifyPage() {
  const { toast } = useToast();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualHash, setManualHash] = useState('');
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; refHint: string | null } | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryHash = async (sha256: string, refCode: string | null, info: { name: string; size: number; refHint: string | null }) => {
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
    await queryHash(cleaned, null, { name: 'Direct SHA-256 Lookup', size: 0, refHint: null });
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
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Verify PDF</h1>
          <p>
            Drop any PDF file to compute its live SHA-256 fingerprint in your browser and verify it against the SignFlow
            Supabase ledger (<code>stage1_sha256</code> and <code>final_sha256</code>).
          </p>
        </div>
      </div>

      <label
        className={`dropzone ${drag ? 'drag' : ''} ${busy ? 'scan-beam' : ''}`}
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
      >
        <div className="dropzone-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 12l2 2 4-4m5 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <strong>{busy ? 'Scanning bytes & querying SHA-256 ledger...' : 'Drop a PDF here to verify its authenticity'}</strong>
        <span className="muted">
          Zero-knowledge file check — the PDF never leaves your browser; only its 64-character SHA-256 digest is queried
        </span>
        <input type="file" accept="application/pdf" hidden onChange={(e) => checkFile(e.target.files?.[0])} />
      </label>

      <div className="card stack">
        <h3>Or Verify by SHA-256 Fingerprint Directly</h3>
        <form className="copy-field" onSubmit={checkManualHash}>
          <input
            className="input"
            placeholder="Paste 64-character SHA-256 hex digest..."
            value={manualHash}
            onChange={(e) => setManualHash(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Verify Hash
          </button>
        </form>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

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
                      Export Audit JSON
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
                  This file claims reference <strong>{result.title}</strong> (<code>{result.refCode}</code>), but its
                  SHA-256 digest does not match either the registered Stage-1 original or the sealed final file. At least
                  one byte was modified after issuance.
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
                  No document with this SHA-256 fingerprint exists in the SignFlow ledger. Either the file was not created
                  by this SignFlow instance, or it was altered and no reference code could be extracted.
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
            <div className="grid-2-even">
              <div className="card stack">
                <h2>Document Record</h2>
                <dl className="kv">
                  <dt>Reference</dt>
                  <dd>
                    <code>{result.refCode}</code>
                  </dd>
                  <dt>Title</dt>
                  <dd>{result.title}</dd>
                  <dt>Status</dt>
                  <dd>
                    <span className={`badge ${result.documentStatus === 'completed' ? 'badge-ok' : 'badge-warn'}`}>
                      {result.documentStatus}
                    </span>
                  </dd>
                  <dt>Signer 1</dt>
                  <dd>{result.signer1Name || '—'}</dd>
                  <dt>Signer 2</dt>
                  <dd>{result.signer2Name || '—'}</dd>
                  <dt>Created (UTC)</dt>
                  <dd>{new Date(result.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd>
                  <dt>Completed (UTC)</dt>
                  <dd>
                    {result.completedAt
                      ? `${new Date(result.completedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
                      : '—'}
                  </dd>
                </dl>
              </div>

              <div className="card stack">
                <div className="row-between">
                  <h2>Audit Event Timeline ({result.events.length})</h2>
                  <span className="badge badge-primary">Chronological UTC</span>
                </div>
                <ul className="timeline">
                  {result.events.map((ev, i) => (
                    <li key={i} className={ev.type}>
                      <div className="t-title">{ev.label}</div>
                      <div className="t-meta">
                        {new Date(ev.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
                        {ev.actorEmail ? ` · ${ev.actorEmail}` : ''}
                        {ev.ipAddress ? ` · IP ${ev.ipAddress}` : ''}
                      </div>
                      {ev.userAgent && <div className="t-meta">UA: {ev.userAgent}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
