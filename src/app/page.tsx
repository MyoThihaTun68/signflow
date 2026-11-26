'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraModal } from '@/components/CameraModal';
import { useAuth } from '@/components/AuthProvider';
import { QrCodeSvg } from '@/components/QrCodeSvg';
import { SignatureCreator } from '@/components/SignatureCreator';
import { useToast } from '@/components/Toast';
import {
  DEFAULT_EDIT,
  DEFAULT_OUTPUT,
  FULL_CROP,
  PRESET_LABELS,
  autoTrim,
  composePage,
  cropCanvas,
  forgetImage,
  formatBytes,
  loadImage,
  renderPageOutput,
  renderTransformed,
  uid,
  type CropRect,
  type OutputSettings,
  type PageEdit,
  type PageSizePreset,
  type Rotation,
  type ScanPage,
} from '@/lib/client/image';
import { rasterizePdf } from '@/lib/client/pdfjs';
import { buildScanPdf, downloadBytes, slugify } from '@/lib/client/buildPdf';
import { generateSamplePaperBlob } from '@/lib/client/samplePaper';
import { sha256Hex } from '@/lib/client/sha256';
import { ORG_ROLE_LABELS, type OrgRole, type TeamMember } from '@/lib/types';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

interface CreatedDoc {
  refCode: string;
  token: string;
  signUrl: string;
  sha256: string;
  senderRole?: OrgRole;
  assignedRole?: OrgRole;
  requireOtp?: boolean;
  emailDelivered: boolean;
  emailTransport: 'resend' | 'smtp' | 'console';
  emailError: string | null;
  pdfBytes: Uint8Array;
}

export default function ScanPreparePage() {
  const { toast } = useToast();
  const { user, openAuthModal } = useAuth();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputSettings>(DEFAULT_OUTPUT);
  const [adjustingCrop, setAdjustingCrop] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);

  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [title, setTitle] = useState('');
  const [senderRole, setSenderRole] = useState<OrgRole>('hr');
  const [signer1Name, setSigner1Name] = useState('Noy Chanthavong (HR)');
  const [signer1Email, setSigner1Email] = useState('hr@signflow.org');
  const [assignedRole, setAssignedRole] = useState<OrgRole>('director');
  const [signer2Name, setSigner2Name] = useState('Somsack Phomvihane (Director)');
  const [signer2Email, setSigner2Email] = useState('director@signflow.org');
  const [requireOtp, setRequireOtp] = useState(false);
  const [includeMark, setIncludeMark] = useState(false);
  const [markPng, setMarkPng] = useState<string | null>(null);
  const [markPos, setMarkPos] = useState<'bl' | 'br'>('br');

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedDoc | null>(null);

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);

  const active = pages.find((p) => p.id === activeId) ?? pages[0] ?? null;

  useEffect(() => {
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.roster?.length) setRoster(data.roster as TeamMember[]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) {
      setSenderRole(user.role);
      setSigner1Name(user.name);
      setSigner1Email(user.email);
    }
  }, [user]);

  const pickAssignedRole = (role: OrgRole) => {
    setAssignedRole(role);
    const match = roster.find((m) => m.role === role);
    if (match) {
      setSigner2Name(match.name);
      setSigner2Email(match.email);
    }
    setRequireOtp(role === 'external');
  };

  const addImageBlob = useCallback(async (blob: Blob, name: string): Promise<ScanPage> => {
    const src = URL.createObjectURL(blob);
    const img = await loadImage(src);
    return {
      id: uid(),
      name,
      src,
      width: img.naturalWidth,
      height: img.naturalHeight,
      edit: { ...DEFAULT_EDIT, crop: { ...FULL_CROP } },
    };
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setImporting(true);
      setError(null);
      try {
        const added: ScanPage[] = [];
        for (const f of list) {
          if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
            const blobs = await rasterizePdf(new Uint8Array(await f.arrayBuffer()));
            for (let i = 0; i < blobs.length; i++) {
              added.push(await addImageBlob(blobs[i], `${f.name} (p.${i + 1})`));
            }
          } else if (f.type.startsWith('image/')) {
            added.push(await addImageBlob(f, f.name));
          }
        }
        if (!added.length) {
          setError('Choose image files (JPG, PNG, WebP) or a PDF.');
          return;
        }
        setPages((prev) => [...prev, ...added]);
        setActiveId((prev) => prev ?? added[0].id);
        if (!title && list[0]) setTitle(list[0].name.replace(/\.[^.]+$/, ''));
        toast(`Loaded ${added.length} page${added.length > 1 ? 's' : ''}`, 'ok');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file.');
      } finally {
        setImporting(false);
      }
    },
    [addImageBlob, title, toast],
  );

  const loadSamplePaper = async () => {
    setImporting(true);
    setError(null);
    try {
      const { blob, name } = await generateSamplePaperBlob();
      const page = await addImageBlob(blob, name);
      setPages((prev) => [...prev, page]);
      setActiveId(page.id);
      if (!title) setTitle('Master Service & NDA Agreement');
      toast('Sample paper loaded — click "Create & Send" on the right!', 'info');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f && (f.type.startsWith('image/') || f.type === 'application/pdf')) files.push(f);
        }
      }
      if (files.length) addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(
    () => () => {
      pagesRef.current.forEach((p) => {
        forgetImage(p.src);
        URL.revokeObjectURL(p.src);
      });
    },
    [],
  );

  const updateEdit = useCallback(
    (patch: Partial<PageEdit>) => {
      if (!active) return;
      setPages((prev) => prev.map((p) => (p.id === active.id ? { ...p, edit: { ...p.edit, ...patch } } : p)));
    },
    [active],
  );

  const rotateBy = useCallback(
    (delta: number) => {
      if (!active) return;
      const next = ((((active.edit.rotation + delta) % 360) + 360) % 360) as Rotation;
      updateEdit({ rotation: next });
    },
    [active, updateEdit],
  );

  const runAutoTrim = useCallback(async () => {
    if (!active) return;
    const img = await loadImage(active.src);
    const transformed = renderTransformed(img, active.edit, 900);
    const rect = autoTrim(transformed);
    updateEdit({ crop: rect });
    toast('Auto-trimmed paper edges', 'info');
  }, [active, toast, updateEdit]);

  const removePage = (id: string) => {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        forgetImage(target.src);
        URL.revokeObjectURL(target.src);
      }
      const next = prev.filter((p) => p.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    if (!active) return;
    (async () => {
      try {
        const img = await loadImage(active.src);
        if (cancelled) return;
        const transformed = renderTransformed(img, active.edit, 1300);
        const stage = stageCanvasRef.current;
        if (stage) {
          stage.width = transformed.width;
          stage.height = transformed.height;
          stage.getContext('2d')!.drawImage(transformed, 0, 0);
        }
        const cropped = cropCanvas(transformed, active.edit.crop);
        const { canvas: composed } = composePage(cropped, output);
        const preview = previewCanvasRef.current;
        if (preview) {
          preview.width = composed.width;
          preview.height = composed.height;
          preview.getContext('2d')!.drawImage(composed, 0, 0);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, output]);

  const startCropDrag = (handle: Handle) => (e: React.PointerEvent) => {
    if (!adjustingCrop || !active) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, start: { ...active.edit.crop } };
  };

  const onCropMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const wrap = cropWrapRef.current;
    if (!d || !wrap || !active) return;
    const r = wrap.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width;
    const dy = (e.clientY - d.startY) / r.height;
    const MIN = 0.08;
    let { x, y, w, h } = d.start;

    if (d.handle === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      let x2 = x + w;
      let y2 = y + h;
      if (d.handle.includes('w')) x = Math.min(x2 - MIN, Math.max(0, x + dx));
      if (d.handle.includes('e')) x2 = Math.max(x + MIN, Math.min(1, x2 + dx));
      if (d.handle.includes('n')) y = Math.min(y2 - MIN, Math.max(0, y + dy));
      if (d.handle.includes('s')) y2 = Math.max(y + MIN, Math.min(1, y2 + dy));
      w = x2 - x;
      h = y2 - y;
    }
    updateEdit({ crop: { x, y, w, h } });
  };

  const endCropDrag = () => {
    dragRef.current = null;
  };

  const buildPdfBytes = async (): Promise<Uint8Array> => {
    const rendered = [];
    for (let i = 0; i < pages.length; i++) {
      setProgress(Math.round(((i + 0.5) / pages.length) * 55));
      rendered.push(await renderPageOutput(pages[i], output));
    }
    const mark =
      includeMark && markPng
        ? { png: markPng, name: signer1Name || signer1Email || 'Sender', position: markPos }
        : null;
    return buildScanPdf(rendered, title || 'Scanned document', mark);
  };

  const handleDownloadOnly = async () => {
    if (!pages.length) return;
    setError(null);
    setBusy('Building PDF...');
    setProgress(20);
    try {
      const bytes = await buildPdfBytes();
      setProgress(100);
      downloadBytes(bytes, `${slugify(title || 'signflow-scan')}.pdf`);
      toast(`Downloaded PDF (${formatBytes(bytes.length)})`, 'ok');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build PDF.');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const handleCreateAndSend = async () => {
    if (!pages.length) return setError('Add at least one page.');
    if (!signer2Email.trim()) return setError('Enter the recipient email.');
    if (includeMark && !markPng) return setError('Draw/Type your signature or uncheck "Sign before sending".');

    setError(null);
    setBusy('Preparing PDF...');
    setProgress(15);
    try {
      const pdfBytes = await buildPdfBytes();
      setBusy('Saving to Team Hub...');
      setProgress(72);
      const clientSha = await sha256Hex(pdfBytes);

      const form = new FormData();
      form.append(
        'file',
        new Blob([pdfBytes as BlobPart], { type: 'application/pdf' }),
        `${slugify(title || 'document')}.pdf`,
      );
      form.append('title', title.trim() || 'Scanned Document');
      form.append('signer1Name', signer1Name.trim());
      form.append('signer1Email', signer1Email.trim());
      form.append('signer2Name', signer2Name.trim());
      form.append('signer2Email', signer2Email.trim());
      form.append('senderRole', senderRole);
      form.append('assignedRole', assignedRole);
      form.append('requireOtp', String(requireOtp));
      form.append('clientSha256', clientSha);

      const res = await fetch('/api/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create signing link.');
      setProgress(100);
      setCreated({ ...data, pdfBytes });
      toast(`Sent to ${ORG_ROLE_LABELS[assignedRole]} (${data.refCode})!`, 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      toast('Could not send document', 'err');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`, 'ok');
  };

  return (
    <div className="stack">
      {/* ── Easy 3-Step Visual Flow Header ── */}
      <div className="card row-between" style={{ padding: '14px 20px' }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="badge badge-primary" style={{ padding: '5px 12px', fontSize: '0.82rem' }}>
            1. Upload / Scan Paper
          </span>
          <span className="muted">→</span>
          <span className="badge badge-primary" style={{ padding: '5px 12px', fontSize: '0.82rem' }}>
            2. Choose Who Signs (Director / Boss / HR)
          </span>
          <span className="muted">→</span>
          <span className="badge badge-ok" style={{ padding: '5px 12px', fontSize: '0.82rem' }}>
            3. Click &amp; Stamp (Done!)
          </span>
        </div>
        {!user && (
          <button type="button" className="btn btn-sm" onClick={() => openAuthModal('login')}>
            Sign In / Create Account
          </button>
        )}
      </div>

      {/* ── Success Card After Sending ── */}
      {created && (
        <div className="card card-hero stack">
          <div className="row-between">
            <div className="row">
              <span className="badge badge-ok">✓ Ready to Sign</span>
              <h2>
                {title || 'Document'} · <code>{created.refCode}</code> → Assigned to{' '}
                <strong>{ORG_ROLE_LABELS[assignedRole]}</strong>
              </h2>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setCreated(null)}>
              + New Paper
            </button>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' }}>
            <div className="stack">
              <div className="row">
                <Link href={`/sign/${created.token}`} className="btn btn-primary btn-lg">
                  Open &amp; Sign This Paper Now →
                </Link>
                <Link href="/team" className="btn btn-lg">
                  View in Team Hub
                </Link>
                <button type="button" className="btn" onClick={() => copyText(created.signUrl, 'Signing link')}>
                  Copy Share Link
                </button>
              </div>
              <div className="copy-field">
                <input className="input" readOnly value={created.signUrl} onFocus={(e) => e.currentTarget.select()} />
              </div>
            </div>
            <QrCodeSvg value={created.signUrl} size={100} />
          </div>
        </div>
      )}

      {/* ── Step 1: Dropzone when no file is loaded ── */}
      {pages.length === 0 ? (
        <div className="stack">
          <label
            className={`dropzone ${dragOver ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
            }}
          >
            <div className="dropzone-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 16V4m0 0-4 4m4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
              </svg>
            </div>
            <strong>{importing ? 'Loading...' : 'Drop a Paper Photo or PDF here (or click to browse)'}</strong>
            <span className="muted">Keeps 100% original colors · Automatically crops &amp; optimizes</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>

          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => setCameraOpen(true)}>
              📷 Take Photo with Camera
            </button>
            <button type="button" className="btn btn-primary" onClick={loadSamplePaper} disabled={importing}>
              ✦ Try with 1-Click Sample Paper
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-2">
          {/* ── Left: Clean Paper Editor ── */}
          <div className="stack">
            <div className="card stack">
              <div className="row-between">
                <div className="row">
                  <h2>Paper Preview ({pages.length} page{pages.length > 1 ? 's' : ''})</h2>
                  <button type="button" className="btn btn-sm btn-primary" onClick={runAutoTrim}>
                    ✦ Auto-Trim Edges
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => rotateBy(-90)}>
                    ↺ -90°
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => rotateBy(90)}>
                    ↻ +90°
                  </button>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className={`btn btn-sm ${showAdvanced ? 'on' : ''}`}
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? 'Hide Fine Tools' : '⚙ Fine Tilt / Page Size'}
                  </button>
                  <label className="btn btn-sm">
                    + Add Page
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      hidden
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                    />
                  </label>
                </div>
              </div>

              {pages.length > 1 && (
                <div className="thumbs">
                  {pages.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`thumb ${active?.id === p.id ? 'active' : ''}`}
                      onClick={() => setActiveId(p.id)}
                    >
                      <span className="thumb-index">{idx + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt={p.name} />
                      <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => removePage(p.id)}>
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Optional Collapsible Fine Tools (hidden by default so UI stays super simple) */}
              {active && showAdvanced && (
                <div
                  className="stack"
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="toolbar">
                    <button
                      type="button"
                      className={`btn btn-sm ${adjustingCrop ? 'on' : ''}`}
                      onClick={() => setAdjustingCrop((v) => !v)}
                    >
                      Crop Handles
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => updateEdit({ crop: { ...FULL_CROP } })}
                    >
                      Reset Crop
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => rotateBy(180)}>
                      180°
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${active.edit.flipH ? 'on' : ''}`}
                      onClick={() => updateEdit({ flipH: !active.edit.flipH })}
                    >
                      Flip H
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${showGrid ? 'on' : ''}`}
                      onClick={() => setShowGrid((g) => !g)}
                    >
                      Grid
                    </button>
                  </div>

                  <label className="field">
                    <span>Fine Straighten / Tilt (-15° to +15°)</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min={-15}
                        max={15}
                        step={0.25}
                        value={active.edit.tilt}
                        onChange={(e) => updateEdit({ tilt: Number(e.target.value) })}
                      />
                      <output>{active.edit.tilt.toFixed(1)}°</output>
                    </div>
                  </label>

                  <div className="fields-2">
                    <div className="field">
                      <span>Page Size</span>
                      <div className="seg full">
                        {(['a4p', 'a4l', 'letter', 'original'] as PageSizePreset[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={output.preset === p ? 'active' : ''}
                            onClick={() => setOutput({ ...output, preset: p })}
                          >
                            {PRESET_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span>Layout</span>
                      <div className="seg full">
                        <button
                          type="button"
                          className={output.mode === 'fit' ? 'active' : ''}
                          onClick={() => setOutput({ ...output, mode: 'fit' })}
                        >
                          Fit w/ Margin
                        </button>
                        <button
                          type="button"
                          className={output.mode === 'fill' ? 'active' : ''}
                          onClick={() => setOutput({ ...output, mode: 'fill' })}
                        >
                          Fill Page
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {active && (
                <div className="editor-stage">
                  <div
                    ref={cropWrapRef}
                    className="crop-wrap"
                    onPointerMove={onCropMove}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                  >
                    <canvas ref={stageCanvasRef} />
                    {(showGrid || active.edit.tilt !== 0) && <div className="grid-overlay" />}
                    <div
                      className={`crop-box ${adjustingCrop ? '' : 'locked'}`}
                      style={{
                        left: `${active.edit.crop.x * 100}%`,
                        top: `${active.edit.crop.y * 100}%`,
                        width: `${active.edit.crop.w * 100}%`,
                        height: `${active.edit.crop.h * 100}%`,
                      }}
                      onPointerDown={startCropDrag('move')}
                    >
                      <div className="crop-thirds" />
                      {adjustingCrop && (
                        <>
                          <span className="handle nw" onPointerDown={startCropDrag('nw')} />
                          <span className="handle ne" onPointerDown={startCropDrag('ne')} />
                          <span className="handle sw" onPointerDown={startCropDrag('sw')} />
                          <span className="handle se" onPointerDown={startCropDrag('se')} />
                          <span className="handle edge n" onPointerDown={startCropDrag('n')} />
                          <span className="handle edge s" onPointerDown={startCropDrag('s')} />
                          <span className="handle edge v w" onPointerDown={startCropDrag('w')} />
                          <span className="handle edge v e" onPointerDown={startCropDrag('e')} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <canvas ref={previewCanvasRef} style={{ display: 'none' }} />
            </div>
          </div>

          {/* ── Right: Ultra-Simple Send Box ── */}
          <div className="stack sticky">
            <div className="card stack">
              <h2>Send Paper for Signature</h2>

              <label className="field">
                <span>Paper / Document Name</span>
                <input
                  className="input"
                  placeholder="e.g. Monthly Expense Approval"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Who Should Sign This Next? (Click 1 Role)</span>
                <div className="seg full">
                  {(['director', 'boss', 'hr', 'finance'] as OrgRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={assignedRole === r ? 'active' : ''}
                      onClick={() => pickAssignedRole(r)}
                    >
                      {ORG_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fields-2">
                <label className="field">
                  <span>Recipient Name</span>
                  <input
                    className="input"
                    value={signer2Name}
                    onChange={(e) => setSigner2Name(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Recipient Email</span>
                  <input
                    className="input"
                    type="email"
                    required
                    value={signer2Email}
                    onChange={(e) => setSigner2Email(e.target.value)}
                  />
                </label>
              </div>

              <label className="check">
                <input type="checkbox" checked={includeMark} onChange={(e) => setIncludeMark(e.target.checked)} />
                <span>Also stamp my own signature on this paper now</span>
              </label>

              {includeMark && (
                <div className="stack" style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 12 }}>
                  <SignatureCreator defaultText={signer1Name} value={markPng} onChange={setMarkPng} />
                  <div className="seg full">
                    <button type="button" className={markPos === 'bl' ? 'active' : ''} onClick={() => setMarkPos('bl')}>
                      Stamp Bottom-Left
                    </button>
                    <button type="button" className={markPos === 'br' ? 'active' : ''} onClick={() => setMarkPos('br')}>
                      Stamp Bottom-Right
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="alert alert-danger">{error}</div>}

              {busy && (
                <div className="stack-sm">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="small muted">{busy}</span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={Boolean(busy)}
                onClick={handleCreateAndSend}
              >
                {busy ? (
                  <>
                    <span className="spinner" /> {busy}
                  </>
                ) : (
                  `Send to ${ORG_ROLE_LABELS[assignedRole]} for Signing →`
                )}
              </button>

              <button
                type="button"
                className="btn btn-block"
                disabled={Boolean(busy)}
                onClick={handleDownloadOnly}
              >
                Or Just Download Clean PDF
              </button>
            </div>
          </div>
        </div>
      )}

      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={async (blob, name) => {
          const p = await addImageBlob(blob, name);
          setPages((prev) => [...prev, p]);
          setActiveId((prev) => prev ?? p.id);
          toast(`Captured ${name}`, 'ok');
        }}
      />
    </div>
  );
}
