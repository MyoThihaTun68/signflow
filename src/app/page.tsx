'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraModal } from '@/components/CameraModal';
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
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputSettings>(DEFAULT_OUTPUT);
  const [adjustingCrop, setAdjustingCrop] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [compareOrig, setCompareOrig] = useState(false);
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

  // Load saved team roster so HR / Director / Boss can be picked in 1 click
  useEffect(() => {
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.roster?.length) setRoster(data.roster as TeamMember[]);
      })
      .catch(() => undefined);
  }, []);

  const pickSenderRole = (role: OrgRole) => {
    setSenderRole(role);
    const match = roster.find((m) => m.role === role);
    if (match) {
      setSigner1Name(match.name);
      setSigner1Email(match.email);
    }
  };

  const pickAssignedRole = (role: OrgRole) => {
    setAssignedRole(role);
    const match = roster.find((m) => m.role === role);
    if (match) {
      setSigner2Name(match.name);
      setSigner2Email(match.email);
    }
    if (role === 'external') setRequireOtp(true);
    else setRequireOtp(false);
  };

  // ── Import images & PDFs ──
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
          setError('Choose image files (JPG, PNG, WebP, HEIC) or a PDF.');
          return;
        }
        setPages((prev) => [...prev, ...added]);
        setActiveId((prev) => prev ?? added[0].id);
        if (!title && list[0]) setTitle(list[0].name.replace(/\.[^.]+$/, ''));
        toast(`Added ${added.length} page${added.length > 1 ? 's' : ''} (original colors preserved)`, 'ok');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file.');
      } finally {
        setImporting(false);
      }
    },
    [addImageBlob, title, toast],
  );

  // 1-Click Sample Paper Contract Demo
  const loadSamplePaper = async () => {
    setImporting(true);
    setError(null);
    try {
      const { blob, name } = await generateSamplePaperBlob();
      const page = await addImageBlob(blob, name);
      setPages((prev) => [...prev, page]);
      setActiveId(page.id);
      if (!title) setTitle('Master Service & NDA Agreement');
      if (!signer1Name) setSigner1Name('Alex Rivera');
      if (!signer1Email) setSigner1Email('alex@signflow.cloud');
      if (!signer2Name) setSigner2Name('Jordan Lee');
      if (!signer2Email) setSigner2Email('jordan@client.org');
      toast('Loaded sample color contract — try "Auto Trim Edges"!', 'info');
    } finally {
      setImporting(false);
    }
  };

  // Support Ctrl+V / Cmd+V clipboard image paste anywhere on the page
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

  // Clean up object URLs on unmount
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
    toast('Edges auto-trimmed to document boundary', 'info');
  }, [active, toast, updateEdit]);

  const autoTrimAll = async () => {
    for (const p of pages) {
      const img = await loadImage(p.src);
      const transformed = renderTransformed(img, p.edit, 900);
      const rect = autoTrim(transformed);
      setPages((prev) => prev.map((item) => (item.id === p.id ? { ...item, edit: { ...item.edit, crop: rect } } : item)));
    }
    toast(`Auto-trimmed all ${pages.length} page(s)`, 'ok');
  };

  // Keyboard shortcuts when not focused in an input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !active) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateBy(e.shiftKey ? -90 : 90);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        runAutoTrim();
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setShowGrid((g) => !g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, rotateBy, runAutoTrim]);

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

  const movePage = (idx: number, dir: -1 | 1) => {
    setPages((prev) => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };

  // ── Draw editor stage + live page preview ──
  useEffect(() => {
    let cancelled = false;
    if (!active) return;
    (async () => {
      try {
        const img = await loadImage(active.src);
        if (cancelled) return;
        const editToShow = compareOrig ? DEFAULT_EDIT : active.edit;
        const transformed = renderTransformed(img, editToShow, 1300);
        const stage = stageCanvasRef.current;
        if (stage) {
          stage.width = transformed.width;
          stage.height = transformed.height;
          stage.getContext('2d')!.drawImage(transformed, 0, 0);
        }
        const cropped = cropCanvas(transformed, editToShow.crop);
        const { canvas: composed } = composePage(cropped, output);
        const preview = previewCanvasRef.current;
        if (preview) {
          preview.width = composed.width;
          preview.height = composed.height;
          preview.getContext('2d')!.drawImage(composed, 0, 0);
        }
      } catch {
        // ignore transient load failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, output, compareOrig]);

  // ── Interactive 4-corner + 4-edge crop box ──
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

  // ── Generate PDF (client-side via pdf-lib) ──
  const buildPdfBytes = async (): Promise<Uint8Array> => {
    const rendered = [];
    for (let i = 0; i < pages.length; i++) {
      setProgress(Math.round(((i + 0.5) / pages.length) * 55));
      rendered.push(await renderPageOutput(pages[i], output));
    }
    const mark =
      includeMark && markPng
        ? { png: markPng, name: signer1Name || signer1Email || 'Signer 1', position: markPos }
        : null;
    return buildScanPdf(rendered, title || 'Scanned document', mark);
  };

  const handleDownloadOnly = async () => {
    if (!pages.length) return;
    setError(null);
    setBusy('Building clean PDF...');
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
    if (!signer2Email.trim()) return setError('Enter Signer 2 email so we can send the signing link and OTP.');
    if (includeMark && !markPng) return setError('Create your Signer 1 mark or uncheck "Add Signer 1 digital mark".');

    setError(null);
    setBusy('Rendering pages & building PDF...');
    setProgress(15);
    try {
      const pdfBytes = await buildPdfBytes();
      setBusy('Computing SHA-256 & uploading to Supabase...');
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
      toast(`Signing link created (${data.refCode})`, 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      toast('Could not create signing link', 'err');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied to clipboard`, 'ok');
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Scan &amp; Prepare</h1>
          <p>
            Convert physical paper into a clean, full-color digital PDF. Crop, auto-trim, rotate and straighten pages,
            then generate a tamper-evident signing link with one click.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={loadSamplePaper} disabled={importing}>
            ✦ Load Sample Paper Contract
          </button>
          <button type="button" className="btn" onClick={() => setCameraOpen(true)}>
            Open Camera
          </button>
          <label className="btn btn-primary">
            + Add Images / PDF
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

      {created && (
        <div className="card card-hero stack">
          <div className="row-between">
            <div className="row">
              <span className="badge badge-ok">✓ Registered &amp; Ready for Co-Sign</span>
              <h2>
                {title || 'Scanned Document'} · <code>{created.refCode}</code>
              </h2>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setCreated(null)}>
              Prepare Another
            </button>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' }}>
            <div className="stack">
              <div className="copy-field">
                <input className="input" readOnly value={created.signUrl} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => copyText(created.signUrl, 'Signing link')}>
                  Copy Link
                </button>
                <Link href={`/sign/${created.token}`} className="btn btn-primary">
                  Open Signing Page →
                </Link>
                <Link href="/team" className="btn">
                  Team Hub
                </Link>
              </div>
              <div className="row-between">
                <span className="small muted">
                  {created.emailDelivered
                    ? `✓ Email delivered to ${signer2Email} via ${created.emailTransport}.`
                    : created.emailTransport === 'console'
                      ? 'Demo mail mode: click "Open Signing Page →" or scan the QR code to co-sign immediately.'
                      : `Email error (${created.emailError ?? 'SMTP'}) — share the link above directly.`}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => downloadBytes(created.pdfBytes, `${created.refCode}-stage1.pdf`)}
                >
                  Download Stage-1 PDF ({formatBytes(created.pdfBytes.length)})
                </button>
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 4 }}>
                  Stage-1 SHA-256 Fingerprint (registered in Supabase ledger)
                </div>
                <div className="hash-box">
                  <span>{created.sha256}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => copyText(created.sha256, 'SHA-256 fingerprint')}
                  >
                    Copy Hash
                  </button>
                </div>
              </div>
            </div>
            <QrCodeSvg value={created.signUrl} size={112} />
          </div>
        </div>
      )}

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
            <strong>
              {importing
                ? 'Importing pages...'
                : 'Drop paper photos or a PDF here, paste from clipboard (Ctrl+V), or click to browse'}
            </strong>
            <span className="muted">
              Multi-page camera &amp; file import · 100% original paper &amp; ink colors · auto-compressed to ≤1400 px
              (0.82 JPEG)
            </span>
            <div className="feature-pills">
              <span className="feature-pill">✦ 4-Corner &amp; Edge Crop</span>
              <span className="feature-pill">✦ Auto-Trim Paper Boundary</span>
              <span className="feature-pill">✦ -15°..+15° Tilt Grid</span>
              <span className="feature-pill">✦ A4 / US Letter Presets</span>
              <span className="feature-pill">✦ SHA-256 + Email OTP Gate</span>
            </div>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>

          <div className="card row-between">
            <div>
              <h3>Want to see the full workflow immediately?</h3>
              <p className="muted small">
                Load a realistic full-color photographed contract on a desk to test Auto-Trim, Tilt, Signer 1 Mark, and
                OTP Co-Signing.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={loadSamplePaper} disabled={importing}>
              ✦ Load Sample Paper Contract
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-2">
          {/* ── Left: page filmstrip + crop/rotate/tilt editor ── */}
          <div className="stack">
            <div className="card stack">
              <div className="row-between">
                <div className="row">
                  <h2>Pages ({pages.length})</h2>
                  <span className="badge badge-primary">100% Original Colors</span>
                  {importing && (
                    <span className="small muted">
                      <span className="spinner" /> importing...
                    </span>
                  )}
                </div>
                <div className="row">
                  {pages.length > 1 && (
                    <button type="button" className="btn btn-sm" onClick={autoTrimAll}>
                      Auto-Trim All
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => setCameraOpen(true)}>
                    + Camera
                  </button>
                  <label className="btn btn-sm">
                    + Files
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
                      <button type="button" title="Move left" disabled={idx === 0} onClick={() => movePage(idx, -1)}>
                        ←
                      </button>
                      <button
                        type="button"
                        title="Move right"
                        disabled={idx === pages.length - 1}
                        onClick={() => movePage(idx, 1)}
                      >
                        →
                      </button>
                      <button type="button" title="Remove page" onClick={() => removePage(p.id)}>
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {active && (
              <div className="card stack">
                <div className="toolbar">
                  <button
                    type="button"
                    className={`btn btn-sm ${adjustingCrop ? 'on' : ''}`}
                    onClick={() => setAdjustingCrop((v) => !v)}
                  >
                    Adjust Crop Box
                  </button>
                  <button type="button" className="btn btn-sm" onClick={runAutoTrim} title="Shortcut: A">
                    Auto Trim Edges
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => updateEdit({ crop: { ...FULL_CROP } })}
                  >
                    Reset Crop
                  </button>
                  <span className="sep" />
                  <button type="button" className="btn btn-sm" onClick={() => rotateBy(-90)} title="Shortcut: Shift+R">
                    -90°
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => rotateBy(90)} title="Shortcut: R">
                    +90°
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
                  <span className="sep" />
                  <button
                    type="button"
                    className={`btn btn-sm ${showGrid ? 'on' : ''}`}
                    onClick={() => setShowGrid((g) => !g)}
                    title="Shortcut: G"
                  >
                    Alignment Grid
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${compareOrig ? 'on' : ''}`}
                    onPointerDown={() => setCompareOrig(true)}
                    onPointerUp={() => setCompareOrig(false)}
                    onPointerLeave={() => setCompareOrig(false)}
                    title="Hold to compare raw unedited photo"
                  >
                    Hold: Original
                  </button>
                </div>

                <label className="field">
                  <div className="row-between">
                    <span>Fine Straighten / Tilt (-15° to +15°)</span>
                    <div className="row">
                      <span className="small muted">
                        Shortcuts: <span className="kbd">A</span> Auto-Trim · <span className="kbd">R</span> Rotate ·{' '}
                        <span className="kbd">G</span> Grid
                      </span>
                      {active.edit.tilt !== 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => updateEdit({ tilt: 0 })}
                        >
                          Reset 0°
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="range-row">
                    <input
                      type="range"
                      min={-15}
                      max={15}
                      step={0.25}
                      value={active.edit.tilt}
                      onFocus={() => setShowGrid(true)}
                      onBlur={() => setShowGrid(false)}
                      onChange={(e) => updateEdit({ tilt: Number(e.target.value) })}
                    />
                    <output>{active.edit.tilt.toFixed(1)}°</output>
                  </div>
                </label>

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
                    {!compareOrig && (
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
                        <span className="crop-dim-badge">
                          {Math.round(active.edit.crop.w * 100)}% × {Math.round(active.edit.crop.h * 100)}%
                        </span>
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
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: output page presets + signer details + submit ── */}
          <div className="stack sticky">
            <div className="card stack">
              <div className="row-between">
                <h2>Output Page Setup</h2>
                <span className="badge badge-muted">≤1400 px · Lightweight</span>
              </div>
              <div className="field">
                <span>Page Size Preset</span>
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
                <span>Scaling Mode</span>
                <div className="seg full">
                  <button
                    type="button"
                    className={output.mode === 'fit' ? 'active' : ''}
                    onClick={() => setOutput({ ...output, mode: 'fit' })}
                  >
                    Fit w/ White Margin
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
              <div className="fields-2">
                <label className="field">
                  <span>Margin %</span>
                  <div className="range-row">
                    <input
                      type="range"
                      min={0}
                      max={18}
                      step={0.5}
                      value={output.margin}
                      onChange={(e) => setOutput({ ...output, margin: Number(e.target.value) })}
                    />
                    <output>{output.margin}%</output>
                  </div>
                </label>
                <label className="field">
                  <span>Zoom %</span>
                  <div className="range-row">
                    <input
                      type="range"
                      min={60}
                      max={160}
                      step={2}
                      value={output.zoom}
                      onChange={(e) => setOutput({ ...output, zoom: Number(e.target.value) })}
                    />
                    <output>{output.zoom}%</output>
                  </div>
                </label>
              </div>
              <div className="field">
                <span>Compression Format</span>
                <div className="seg full">
                  <button
                    type="button"
                    className={output.format === 'jpeg' ? 'active' : ''}
                    onClick={() => setOutput({ ...output, format: 'jpeg' })}
                  >
                    JPEG 0.82 · ≤1400 px
                  </button>
                  <button
                    type="button"
                    className={output.format === 'png' ? 'active' : ''}
                    onClick={() => setOutput({ ...output, format: 'png' })}
                  >
                    PNG · ≤1400 px
                  </button>
                </div>
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Live page sheet preview ({PRESET_LABELS[output.preset]})
                </div>
                <canvas ref={previewCanvasRef} className="preview-canvas" />
              </div>
            </div>

            <div className="card stack">
              <div className="row-between">
                <h2>Document &amp; Team Routing</h2>
                <Link href="/team" className="btn btn-sm">
                  Manage Team
                </Link>
              </div>
              <label className="field">
                <span>Document Title</span>
                <input
                  className="input"
                  placeholder="e.g. Service Agreement — Q4"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Prepared By (Your Role)</span>
                <div className="seg full">
                  {(['hr', 'director', 'boss', 'manager'] as OrgRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={senderRole === r ? 'active' : ''}
                      onClick={() => pickSenderRole(r)}
                    >
                      {ORG_ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fields-2">
                <label className="field">
                  <span>Sender Name</span>
                  <input
                    className="input"
                    placeholder="Noy (HR)"
                    value={signer1Name}
                    onChange={(e) => setSigner1Name(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Sender Email</span>
                  <input
                    className="input"
                    type="email"
                    placeholder="hr@signflow.org"
                    value={signer1Email}
                    onChange={(e) => setSigner1Email(e.target.value)}
                  />
                </label>
              </div>

              <div className="field">
                <span>Route To (Next Approver / Signer Role)</span>
                <div className="seg full">
                  {(['director', 'boss', 'hr', 'finance', 'external'] as OrgRole[]).map((r) => (
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

              {roster.length > 0 && (
                <label className="field">
                  <span>Quick-Pick Team Member</span>
                  <select
                    className="select"
                    value={signer2Email}
                    onChange={(e) => {
                      const m = roster.find((x) => x.email === e.target.value);
                      if (m) {
                        setAssignedRole(m.role);
                        setSigner2Name(m.name);
                        setSigner2Email(m.email);
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
                  <span>Assignee Name</span>
                  <input
                    className="input"
                    placeholder="Somsack (Director)"
                    value={signer2Name}
                    onChange={(e) => setSigner2Name(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Assignee Email (required)</span>
                  <input
                    className="input"
                    type="email"
                    required
                    placeholder="director@signflow.org"
                    value={signer2Email}
                    onChange={(e) => setSigner2Email(e.target.value)}
                  />
                </label>
              </div>

              <label className="check">
                <input type="checkbox" checked={requireOtp} onChange={(e) => setRequireOtp(e.target.checked)} />
                <span>Require 6-Digit Email OTP (off by default for fast internal HR / Director / Boss signing)</span>
              </label>

              <label className="check">
                <input type="checkbox" checked={includeMark} onChange={(e) => setIncludeMark(e.target.checked)} />
                <span>Add your digital mark on page 1 before routing (Draw or Type)</span>
              </label>

              {includeMark && (
                <div className="stack" style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 12 }}>
                  <SignatureCreator defaultText={signer1Name} value={markPng} onChange={setMarkPng} />
                  <div className="row-between">
                    <span className="small muted">Stamp position on last page</span>
                    <div className="seg">
                      <button
                        type="button"
                        className={markPos === 'bl' ? 'active' : ''}
                        onClick={() => setMarkPos('bl')}
                      >
                        Bottom-left
                      </button>
                      <button
                        type="button"
                        className={markPos === 'br' ? 'active' : ''}
                        onClick={() => setMarkPos('br')}
                      >
                        Bottom-right
                      </button>
                    </div>
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
                  'Create & Send Signing Link'
                )}
              </button>
              <button
                type="button"
                className="btn btn-block"
                disabled={Boolean(busy)}
                onClick={handleDownloadOnly}
              >
                Download Clean PDF Only
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
