'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanvas, loadImage, stripPaperBackground, trimToPng } from '@/lib/client/image';
import { SIGNATURE_FONTS } from '@/lib/fonts';

const COLORS = [
  { label: 'Navy', value: '#0f172a' },
  { label: 'Royal Blue', value: '#1d4ed8' },
  { label: 'Emerald', value: '#15803d' },
  { label: 'Violet', value: '#6d28d9' },
];

const STROKE_WIDTHS = [
  { label: 'Fine', value: 2.5 },
  { label: 'Medium', value: 4.2 },
  { label: 'Bold', value: 6.2 },
];

interface Props {
  allowPhoto?: boolean;
  defaultText?: string;
  value: string | null;
  onChange(pngDataUrl: string | null): void;
}

export function SignatureCreator({ allowPhoto = false, defaultText = '', value, onChange }: Props) {
  const [mode, setMode] = useState<'draw' | 'type' | 'photo'>('draw');
  const [color, setColor] = useState(COLORS[1].value);
  const [strokeW, setStrokeW] = useState(STROKE_WIDTHS[1].value);
  const [text, setText] = useState(defaultText);
  const [fontIdx, setFontIdx] = useState(0);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(55);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [historyLen, setHistoryLen] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotsRef = useRef<ImageData[]>([]);
  const drawingRef = useRef<{ active: boolean; x: number; y: number; midX: number; midY: number }>({
    active: false,
    x: 0,
    y: 0,
    midX: 0,
    midY: 0,
  });

  // Sync defaultText into type box when user enters their name
  useEffect(() => {
    if (!text && defaultText) setText(defaultText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultText]);

  const clearCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    snapshotsRef.current = [];
    setHistoryLen(0);
    onChange(null);
  }, [onChange]);

  const undoStroke = useCallback(() => {
    const c = canvasRef.current;
    if (!c || snapshotsRef.current.length === 0) return;
    const ctx = c.getContext('2d')!;
    const prev = snapshotsRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    setHistoryLen(snapshotsRef.current.length);
    onChange(trimToPng(c));
  }, [onChange]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // Save snapshot for Undo
    snapshotsRef.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (snapshotsRef.current.length > 25) snapshotsRef.current.shift();
    setHistoryLen(snapshotsRef.current.length);

    const p = point(e);
    drawingRef.current = { active: true, x: p.x, y: p.y, midX: p.x, midY: p.y };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, strokeW * 0.55, 0, Math.PI * 2);
    ctx.fill();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawingRef.current;
    if (!d.active) return;
    const p = point(e);
    const midX = (d.x + p.x) / 2;
    const midY = (d.y + p.y) / 2;
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(d.midX, d.midY);
    ctx.quadraticCurveTo(d.x, d.y, midX, midY);
    ctx.stroke();
    d.x = p.x;
    d.y = p.y;
    d.midX = midX;
    d.midY = midY;
  };

  const up = () => {
    if (!drawingRef.current.active) return;
    drawingRef.current.active = false;
    if (canvasRef.current) onChange(trimToPng(canvasRef.current));
  };

  // ── Type mode ──
  useEffect(() => {
    if (mode !== 'type') return;
    const trimmed = text.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    let cancelled = false;
    const font = SIGNATURE_FONTS[fontIdx];
    const render = () => {
      if (cancelled) return;
      const c = createCanvas(900, 260);
      const ctx = c.getContext('2d')!;
      let size = 112;
      ctx.font = `600 ${size}px ${font.family}, cursive`;
      while (size > 34 && ctx.measureText(trimmed).width > c.width - 60) {
        size -= 4;
        ctx.font = `600 ${size}px ${font.family}, cursive`;
      }
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(trimmed, 30, c.height / 2);
      onChange(trimToPng(c, 12));
    };
    if (document.fonts?.ready) document.fonts.ready.then(render);
    else render();
    return () => {
      cancelled = true;
    };
  }, [mode, text, fontIdx, color, onChange]);

  // ── Photo scan mode ──
  useEffect(() => {
    if (mode !== 'photo' || !photoSrc) return;
    let cancelled = false;
    setPhotoErr(null);
    loadImage(photoSrc)
      .then((img) => {
        if (cancelled) return;
        const png = stripPaperBackground(img, sensitivity);
        if (!png) setPhotoErr('No ink detected. Move the threshold slider to the right or try a clearer photo.');
        onChange(png);
      })
      .catch(() => !cancelled && setPhotoErr('Could not read that image.'));
    return () => {
      cancelled = true;
    };
  }, [mode, photoSrc, sensitivity, onChange]);

  const onPhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (photoSrc) URL.revokeObjectURL(photoSrc);
    setPhotoSrc(URL.createObjectURL(file));
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="tablist">
          <button type="button" className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>
            Draw
          </button>
          <button type="button" className={mode === 'type' ? 'active' : ''} onClick={() => setMode('type')}>
            Type
          </button>
          {allowPhoto && (
            <button type="button" className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>
              Photo Scan
            </button>
          )}
        </div>
        {mode !== 'photo' && (
          <div className="row">
            {mode === 'draw' && (
              <div className="seg">
                {STROKE_WIDTHS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className={strokeW === s.value ? 'active' : ''}
                    onClick={() => setStrokeW(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <div className="swatches" aria-label="Ink color">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`swatch ${color === c.value ? 'active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {mode === 'draw' && (
        <div>
          <div className="sigpad">
            <canvas
              ref={canvasRef}
              width={720}
              height={240}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
            <div className="sigpad-line" />
            <div className="sigpad-hint">Sign smoothly above the line</div>
          </div>
          <div className="row-between" style={{ marginTop: 8 }}>
            <span className="muted small">{value ? '✓ Signature ready' : 'Draw with mouse, stylus, or finger'}</span>
            <div className="row">
              <button type="button" className="btn btn-sm" disabled={historyLen === 0} onClick={undoStroke}>
                ↶ Undo
              </button>
              <button type="button" className="btn btn-sm" disabled={!value && historyLen === 0} onClick={clearCanvas}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'type' && (
        <div className="stack">
          <input
            className="input"
            placeholder="Type your full name"
            value={text}
            maxLength={60}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="font-choices">
            {SIGNATURE_FONTS.map((f, i) => (
              <button
                key={f.id}
                type="button"
                className={`font-choice ${f.className} ${fontIdx === i ? 'active' : ''}`}
                style={{ color }}
                onClick={() => setFontIdx(i)}
              >
                {text.trim() || 'SignFlow'}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'photo' && (
        <div className="stack">
          <label className="btn">
            Upload photo of signature on paper (auto-strips paper to transparent PNG)
            <input type="file" accept="image/*" hidden onChange={(e) => onPhotoFile(e.target.files?.[0])} />
          </label>
          {photoSrc && (
            <label className="field">
              <span>Ink Sensitivity / Background Removal Threshold</span>
              <div className="range-row">
                <input
                  type="range"
                  min={15}
                  max={90}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                />
                <output>{sensitivity}%</output>
              </div>
            </label>
          )}
          {photoErr && <div className="alert alert-warn">{photoErr}</div>}
          {value && (
            <div className="sig-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt="Cleaned transparent signature" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
