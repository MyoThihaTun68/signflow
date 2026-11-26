'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { PdfCanvasViewer } from '@/components/PdfCanvasViewer';
import { SignatureCreator } from '@/components/SignatureCreator';
import { dataUrlToBytes, drawStamp } from '@/lib/pdf/stamp';
import { downloadBytes, slugify } from '@/lib/client/buildPdf';
import { sha256Hex } from '@/lib/client/sha256';
import { DECISION_LABELS, type Decision } from '@/lib/types';

function parseToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\/sign\/([A-Za-z0-9_-]{20,128})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,128}$/.test(trimmed)) return trimmed;
  return null;
}

export default function SignLandingPage() {
  const router = useRouter();
  const [linkInput, setLinkInput] = useState('');
  const [linkErr, setLinkErr] = useState<string | null>(null);

  // Direct PDF loader state
  const [fileName, setFileName] = useState('');
  const [rawPdf, setRawPdf] = useState<Uint8Array | null>(null);
  const [viewPdf, setViewPdf] = useState<Uint8Array | null>(null);
  const [page, setPage] = useState(0);
  const [stampPos, setStampPos] = useState<{ page: number; cx: number; cy: number } | null>(null);
  const [widthFrac, setWidthFrac] = useState(0.24);
  const [decision, setDecision] = useState<Decision>('approved');
  const [note, setNote] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ bytes: Uint8Array; sha256: string; refCode: string } | null>(null);

  const openToken = (e: React.FormEvent) => {
    e.preventDefault();
    const token = parseToken(linkInput);
    if (!token) {
      setLinkErr('Paste a valid /sign/<token> link or token.');
      return;
    }
    router.push(`/sign/${token}`);
  };

  const loadLocalFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSealed(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      setError('Selected file is not a valid PDF.');
      return;
    }
    setFileName(file.name.replace(/\.pdf$/i, ''));
    setRawPdf(bytes);
    setViewPdf(bytes);
    setPage(0);
    setStampPos({ page: 0, cx: 0.72, cy: 0.82 });
  };

  const sealDirectPdf = async () => {
    if (!rawPdf) return;
    if (!signaturePng) return setError('Create your signature first.');
    if (!stampPos) return setError('Click on the PDF page to position your signature.');
    if (decision === 'approved_with_notes' && !note.trim()) return setError('Add a note for "Approved w/ Notes".');

    setBusy('Embedding signature on page...');
    setError(null);
    try {
      const refCode = `SF-${Math.floor(100000 + Math.random() * 900000)}`;

      const pdf = await PDFDocument.load(rawPdf, { updateMetadata: false });
      // Embed ONLY the pure signature image on the page (zero text/email clutter)
      await drawStamp(pdf, stampPos.page, dataUrlToBytes(signaturePng), { cx: stampPos.cx, cy: stampPos.cy, widthFrac }, []);
      pdf.setSubject(`SignFlow ${refCode}`);
      pdf.setProducer('SignFlow (pdf-lib)');
      pdf.setModificationDate(new Date());
      const finalBytes = await pdf.save();
      const finalSha = await sha256Hex(finalBytes);
      setSealed({ bytes: finalBytes, sha256: finalSha, refCode });
      setViewPdf(finalBytes);
      setPage(stampPos.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign PDF.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Review &amp; Co-Sign</h1>
          <p>Open a signing link you received by email, or load any PDF directly from your computer to stamp and seal it.</p>
        </div>
      </div>

      <div className="card stack">
        <h2>Have a Signing Link or Token?</h2>
        <form className="copy-field" onSubmit={openToken}>
          <input
            className="input"
            placeholder="Paste https://.../sign/AbCdEf... or the token itself"
            value={linkInput}
            onChange={(e) => {
              setLinkInput(e.target.value);
              setLinkErr(null);
            }}
          />
          <button type="submit" className="btn btn-primary">
            Open Signing Request
          </button>
        </form>
        {linkErr && <div className="alert alert-danger">{linkErr}</div>}
      </div>

      <div className="card stack">
        <div className="row-between">
          <div>
            <h2>Direct PDF Loader</h2>
            <p className="muted small">Load any local PDF, position your signature stamp on the page, and download a sealed PDF.</p>
          </div>
          <label className="btn btn-primary">
            {rawPdf ? 'Load Different PDF' : 'Load PDF File'}
            <input type="file" accept="application/pdf" hidden onChange={(e) => loadLocalFile(e.target.files?.[0])} />
          </label>
        </div>

        {!rawPdf ? (
          <label className="dropzone">
            <strong>Drop a PDF file here or click to load</strong>
            <span className="muted">Rendered locally in your browser with pdfjs-dist and sealed with pdf-lib</span>
            <input type="file" accept="application/pdf" hidden onChange={(e) => loadLocalFile(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="grid-2">
            <div className="stack">
              <PdfCanvasViewer
                data={viewPdf}
                page={page}
                onPageChange={setPage}
                interactive={!sealed && Boolean(signaturePng)}
                onPlace={(p, cx, cy) => setStampPos({ page: p, cx, cy })}
                stamp={
                  !sealed && signaturePng && stampPos
                    ? {
                        page: stampPos.page,
                        cx: stampPos.cx,
                        cy: stampPos.cy,
                        widthFrac,
                        png: signaturePng,
                      }
                    : null
                }
              />
            </div>

            <div className="stack">
              {sealed && (
                <div className="alert alert-ok stack">
                  <strong>✓ Sealed ({sealed.refCode}) — Transparent signature stamped on page</strong>
                  <div className="hash">{sealed.sha256}</div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => downloadBytes(sealed.bytes, `${slugify(fileName)}-${sealed.refCode}-sealed.pdf`)}
                    >
                      Download Sealed PDF
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setSealed(null);
                        setViewPdf(rawPdf);
                        setPage(0);
                      }}
                    >
                      Edit &amp; Re-seal
                    </button>
                  </div>
                </div>
              )}

              <div className="fields-2">
                <label className="field">
                  <span>Your Name</span>
                  <input className="input" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Jordan Lee" />
                </label>
                <label className="field">
                  <span>Your Email</span>
                  <input className="input" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder="jordan@client.com" />
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
                <span>Note</span>
                <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note..." />
              </label>

              <SignatureCreator
                allowPhoto
                defaultText={signerName}
                value={signaturePng}
                onChange={(png) => {
                  setSignaturePng(png);
                  if (png && !stampPos) setStampPos({ page, cx: 0.72, cy: 0.82 });
                }}
              />

              <label className="field">
                <span>Stamp Size</span>
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

              {error && <div className="alert alert-danger">{error}</div>}

              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={Boolean(busy)} onClick={sealDirectPdf}>
                {busy || 'Stamp & Download Sealed PDF'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
