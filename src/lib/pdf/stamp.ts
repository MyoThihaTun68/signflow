import { PDFDocument, PDFPage, PDFFont, StandardFonts, degrees, rgb, type RGB } from 'pdf-lib';

/** Standard PDF fonts only support WinAnsi; replace anything else safely. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
}

export interface PageFrame {
  rotation: 0 | 90 | 180 | 270;
  /** width/height of the page as it is displayed (after /Rotate) */
  displayW: number;
  displayH: number;
  /** maps a display-space point (pt, top-left origin) to PDF user space */
  toPdf(dx: number, dy: number): { x: number; y: number };
}

export function pageFrame(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  const r = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const w = box.width;
  const h = box.height;
  const displayW = r === 90 || r === 270 ? h : w;
  const displayH = r === 90 || r === 270 ? w : h;
  const toPdf = (dx: number, dy: number) => {
    const fx = dx / displayW;
    const fy = dy / displayH;
    let x: number;
    let y: number;
    switch (r) {
      case 90:
        x = fy * w;
        y = fx * h;
        break;
      case 180:
        x = (1 - fx) * w;
        y = fy * h;
        break;
      case 270:
        x = (1 - fy) * w;
        y = (1 - fx) * h;
        break;
      default:
        x = fx * w;
        y = (1 - fy) * h;
    }
    return { x: box.x + x, y: box.y + y };
  };
  return { rotation: r, displayW, displayH, toPdf };
}

export interface StampPlacement {
  /** centre of the stamp in display fractions (0..1, top-left origin) */
  cx: number;
  cy: number;
  /** stamp width as a fraction of the displayed page width */
  widthFrac: number;
}

export interface StampLabel {
  text: string;
  size: number;
  bold?: boolean;
  color?: RGB;
}

export interface StampResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws a signature image + caption lines onto a page at a display-space position.
 * Works for rotated pages; pdf-lib is isomorphic so this runs in browser and server.
 */
export async function drawStamp(
  pdf: PDFDocument,
  pageIndex: number,
  png: Uint8Array,
  placement: StampPlacement,
  labels: StampLabel[],
): Promise<StampResult> {
  const page = pdf.getPage(pageIndex);
  const frame = pageFrame(page);
  const image = await pdf.embedPng(png);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const rotate = degrees(frame.rotation);

  const w = Math.max(10, placement.widthFrac * frame.displayW);
  const h = (w * image.height) / image.width;
  const cx = placement.cx * frame.displayW;
  const cy = placement.cy * frame.displayH;
  const left = cx - w / 2;
  const top = cy - h / 2;

  const anchor = frame.toPdf(left, top + h);
  page.drawImage(image, { x: anchor.x, y: anchor.y, width: w, height: h, rotate });

  const maxTextWidth = Math.max(w, 170);
  let cursor = top + h + 2;
  for (const label of labels) {
    const font = label.bold ? bold : regular;
    const lines = wrap(pdfSafe(label.text), font, label.size, maxTextWidth).slice(0, 5);
    for (const line of lines) {
      cursor += label.size * 1.2;
      const tw = font.widthOfTextAtSize(line, label.size);
      const tx = Math.min(Math.max(cx - tw / 2, 4), frame.displayW - tw - 4);
      const p = frame.toPdf(tx, cursor);
      page.drawText(line, {
        x: p.x,
        y: p.y,
        size: label.size,
        font,
        color: label.color ?? rgb(0.15, 0.18, 0.25),
        rotate,
      });
    }
  }
  return { x: anchor.x, y: anchor.y, width: w, height: h };
}

/** Small reference footer added to every page of a registered document. */
export async function drawRefFooter(pdf: PDFDocument, refCode: string): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const text = `SignFlow · ${refCode}`;
  const size = 7;
  for (const page of pdf.getPages()) {
    const frame = pageFrame(page);
    const tw = font.widthOfTextAtSize(pdfSafe(text), size);
    const p = frame.toPdf(frame.displayW - tw - 10, frame.displayH - 8);
    page.drawText(pdfSafe(text), {
      x: p.x,
      y: p.y,
      size,
      font,
      color: rgb(0.55, 0.6, 0.68),
      rotate: degrees(frame.rotation),
    });
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export const DECISION_COLORS = {
  approved: rgb(0.09, 0.5, 0.27),
  approved_with_notes: rgb(0.72, 0.45, 0.05),
  rejected: rgb(0.78, 0.15, 0.15),
} as const;
