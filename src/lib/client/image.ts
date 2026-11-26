'use client';

/* Client-side image pipeline for the paper → digital scanner.
   Original colours are always preserved: no grayscale / threshold filters. */

export type Rotation = 0 | 90 | 180 | 270;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageEdit {
  rotation: Rotation;
  flipH: boolean;
  tilt: number;
  crop: CropRect;
}

export interface ScanPage {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  edit: PageEdit;
}

export type PageSizePreset = 'a4p' | 'a4l' | 'letter' | 'original';

export interface OutputSettings {
  preset: PageSizePreset;
  mode: 'fit' | 'fill';
  margin: number;
  zoom: number;
  format: 'jpeg' | 'png';
}

export const MAX_OUTPUT_SIDE = 1400;
export const JPEG_QUALITY = 0.82;
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_EDIT: PageEdit = { rotation: 0, flipH: false, tilt: 0, crop: FULL_CROP };

export const DEFAULT_OUTPUT: OutputSettings = { preset: 'a4p', mode: 'fit', margin: 3, zoom: 100, format: 'jpeg' };

export const PRESET_LABELS: Record<PageSizePreset, string> = {
  a4p: 'A4 Portrait',
  a4l: 'A4 Landscape',
  letter: 'US Letter',
  original: 'Original Ratio',
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
    imageCache.set(src, p);
    p.catch(() => imageCache.delete(src));
  }
  return p;
}

export function forgetImage(src: string): void {
  imageCache.delete(src);
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Applies rotation, horizontal flip and fine tilt. Corners exposed by tilt are filled white. */
export function renderTransformed(img: HTMLImageElement, edit: PageEdit, maxSide = 1800): HTMLCanvasElement {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.min(1, maxSide / Math.max(iw, ih));
  const w = iw * s;
  const h = ih * s;
  const angle = ((edit.rotation + edit.tilt) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const outW = w * cos + h * sin;
  const outH = w * sin + h * cos;
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (edit.flipH) ctx.scale(-1, 1);
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

export function cropCanvas(src: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const sx = Math.round(crop.x * src.width);
  const sy = Math.round(crop.y * src.height);
  const sw = Math.max(1, Math.round(crop.w * src.width));
  const sh = Math.max(1, Math.round(crop.h * src.height));
  const out = createCanvas(sw, sh);
  out.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

export function pageSizePt(preset: PageSizePreset, imgW: number, imgH: number): { w: number; h: number } {
  switch (preset) {
    case 'a4p':
      return { w: 595.28, h: 841.89 };
    case 'a4l':
      return { w: 841.89, h: 595.28 };
    case 'letter':
      return { w: 612, h: 792 };
    default: {
      const longest = 841.89;
      return imgW >= imgH ? { w: longest, h: (longest * imgH) / imgW } : { w: (longest * imgW) / imgH, h: longest };
    }
  }
}

/** Places the cropped image on a white page of the chosen size (fit/fill, margin, zoom). */
export function composePage(img: HTMLCanvasElement, settings: OutputSettings): { canvas: HTMLCanvasElement; wPt: number; hPt: number } {
  const { w: wPt, h: hPt } = pageSizePt(settings.preset, img.width, img.height);
  const pxPerPt = MAX_OUTPUT_SIDE / Math.max(wPt, hPt);
  const canvas = createCanvas(wPt * pxPerPt, hPt * pxPerPt);
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const m = (Math.min(Math.max(settings.margin, 0), 25) / 100) * Math.min(W, H);
  const areaW = W - 2 * m;
  const areaH = H - 2 * m;
  const base =
    settings.mode === 'fit' ? Math.min(areaW / img.width, areaH / img.height) : Math.max(areaW / img.width, areaH / img.height);
  const scale = base * (Math.min(Math.max(settings.zoom, 25), 300) / 100);
  const dw = img.width * scale;
  const dh = img.height * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(m, m, areaW, areaH);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
  return { canvas, wPt, hPt };
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: 'jpeg' | 'png', quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      format === 'png' ? 'image/png' : 'image/jpeg',
      quality,
    ),
  );
}

export interface PageOutput {
  bytes: Uint8Array;
  format: 'jpeg' | 'png';
  wPt: number;
  hPt: number;
  canvas: HTMLCanvasElement;
}

export async function renderPageOutput(page: ScanPage, settings: OutputSettings): Promise<PageOutput> {
  const img = await loadImage(page.src);
  const transformed = renderTransformed(img, page.edit, 2400);
  const cropped = cropCanvas(transformed, page.edit.crop);
  const { canvas, wPt, hPt } = composePage(cropped, settings);
  const blob = await canvasToBlob(canvas, settings.format);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), format: settings.format, wPt, hPt, canvas };
}

/* ── Auto trim ─────────────────────────────────────────────── */

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Detects the document area: first tries "paper on a contrasting background",
 * then falls back to trimming uniform margins around the content.
 */
export function autoTrim(src: HTMLCanvasElement): CropRect {
  const scale = Math.min(1, 320 / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * scale));
  const h = Math.max(8, Math.round(src.height * scale));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const br = median(rs);
  const bg = median(gs);
  const bb = median(bs);

  const rowFrac = new Float32Array(h);
  const colFrac = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb);
      if (d > 48) {
        rowFrac[y] += 1 / w;
        colFrac[x] += 1 / h;
      }
    }
  }

  const bounds = (t: number) => {
    let top = 0;
    let bottom = h - 1;
    let left = 0;
    let right = w - 1;
    while (top < h && rowFrac[top] <= t) top++;
    while (bottom > top && rowFrac[bottom] <= t) bottom--;
    while (left < w && colFrac[left] <= t) left++;
    while (right > left && colFrac[right] <= t) right--;
    if (top >= bottom || left >= right) return null;
    return { left, top, right, bottom };
  };

  for (const t of [0.35, 0.02]) {
    const b = bounds(t);
    if (!b) continue;
    const area = ((b.right - b.left + 1) * (b.bottom - b.top + 1)) / (w * h);
    if (area < 0.08 || area > 0.985) continue;
    const pad = 0.006;
    const x = Math.max(0, b.left / w - pad);
    const y = Math.max(0, b.top / h - pad);
    const x2 = Math.min(1, (b.right + 1) / w + pad);
    const y2 = Math.min(1, (b.bottom + 1) / h + pad);
    return { x, y, w: x2 - x, h: y2 - y };
  }
  return FULL_CROP;
}

/* ── Signature helpers ─────────────────────────────────────── */

/** Trims transparent pixels around a canvas and returns a PNG data URL. */
export function trimToPng(src: HTMLCanvasElement, padding = 8): string | null {
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = src;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const cw = Math.min(w, maxX + padding + 1) - x;
  const ch = Math.min(h, maxY + padding + 1) - y;
  const out = createCanvas(cw, ch);
  out.getContext('2d')!.drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
  return out.toDataURL('image/png');
}

/**
 * Removes the paper background from a photographed signature.
 * sensitivity 0..100 – higher keeps more faint strokes.
 */
export function stripPaperBackground(img: HTMLImageElement, sensitivity = 55): string | null {
  const s = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = createCanvas(img.naturalWidth * s, img.naturalHeight * s);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;

  const lum = new Float32Array(c.width * c.height);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = l;
    hist[Math.min(255, Math.round(l))]++;
  }
  const percentile = (q: number) => {
    const target = lum.length * q;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const paper = percentile(0.85);
  const ink = Math.min(percentile(0.02), paper - 20);
  const cut = ink + (paper - ink) * (0.35 + (sensitivity / 100) * 0.5);
  const soft = Math.max(6, (cut - ink) * 0.55);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const l = lum[p];
    if (l >= cut) {
      d[i + 3] = 0;
    } else {
      const a = Math.min(1, (cut - l) / soft);
      d[i + 3] = Math.round(a * 255);
      // deepen the ink slightly while keeping its hue
      d[i] = Math.round(d[i] * 0.85);
      d[i + 1] = Math.round(d[i + 1] * 0.85);
      d[i + 2] = Math.round(d[i + 2] * 0.85);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return trimToPng(c, 10);
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
