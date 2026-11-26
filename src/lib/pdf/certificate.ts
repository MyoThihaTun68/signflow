import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { EVENT_LABELS, type AuditEventType } from '@/lib/types';
import { pdfSafe } from './stamp';

export interface CertificateEvent {
  type: AuditEventType;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface CertificateInput {
  heading?: string;
  refCode: string;
  title: string;
  documentId: string;
  signer1: string;
  signer2: string;
  outcome: string;
  note: string | null;
  stage1Sha256: string;
  signedContentSha256: string;
  sealMethod: string;
  sealValue: string;
  events: CertificateEvent[];
  generatedAt: string;
  verifyUrl: string;
  footerNote?: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.88, 0.9, 0.94);
const ACCENT = rgb(0.15, 0.39, 0.92);

export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function truncate(text: string, font: PDFFont, size: number, max: number): string {
  let t = pdfSafe(text);
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
  return `${t}...`;
}

function wrapText(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= max || !line) line = cand;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Appends a "Certificate of Completion" (one or more A4 pages) to the document. */
export async function appendCertificate(pdf: PDFDocument, input: CertificateInput): Promise<void> {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const contentW = A4[0] - M * 2;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  let pageNo = 1;

  const header = (continued: boolean) => {
    page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: ACCENT });
    page.drawText('SignFlow', { x: M, y: y - 4, size: 11, font: bold, color: ACCENT });
    const right = pdfSafe(`Ref ${input.refCode}`);
    page.drawText(right, {
      x: A4[0] - M - regular.widthOfTextAtSize(right, 9),
      y: y - 4,
      size: 9,
      font: regular,
      color: MUTED,
    });
    y -= 34;
    const h = pdfSafe(`${input.heading ?? 'Certificate of Completion'}${continued ? ' (continued)' : ''}`);
    page.drawText(h, { x: M, y, size: 20, font: bold, color: INK });
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: LINE });
    y -= 20;
  };

  const footer = () => {
    const txt = pdfSafe(`Generated ${formatUtc(input.generatedAt)}  ·  Verify at ${input.verifyUrl}  ·  Page ${pageNo}`);
    page.drawText(truncate(txt, regular, 7.5, contentW), { x: M, y: 28, size: 7.5, font: regular, color: MUTED });
  };

  const ensure = (needed: number) => {
    if (y - needed < 60) {
      footer();
      page = pdf.addPage(A4);
      pageNo += 1;
      y = A4[1] - M;
      header(true);
    }
  };

  header(false);

  // ── Summary block ──
  const rows: [string, string][] = [
    ['Document', input.title],
    ['Reference', input.refCode],
    ['Document ID', input.documentId],
    ['Signer 1 (Sender)', input.signer1],
    ['Signer 2 (Co-Signer)', input.signer2],
    ['Outcome', input.outcome],
  ];
  if (input.note) rows.push(['Note', input.note]);
  rows.push(['Seal Method', input.sealMethod]);

  for (const [k, v] of rows) {
    const lines = wrapText(v || '-', regular, 10, contentW - 140);
    ensure(lines.length * 14 + 6);
    page.drawText(pdfSafe(k), { x: M, y, size: 9, font: bold, color: MUTED });
    lines.forEach((line, i) => page.drawText(line, { x: M + 140, y: y - i * 14, size: 10, font: regular, color: INK }));
    y -= lines.length * 14 + 6;
  }

  // ── Fingerprints ──
  const fp = (label: string, hash: string) => {
    ensure(46);
    y -= 6;
    page.drawText(pdfSafe(label), { x: M, y, size: 9, font: bold, color: MUTED });
    y -= 14;
    page.drawRectangle({ x: M, y: y - 8, width: contentW, height: 22, color: rgb(0.96, 0.97, 0.99), borderColor: LINE, borderWidth: 0.8 });
    page.drawText(pdfSafe(hash || '-'), { x: M + 8, y: y - 1, size: 8.6, font: mono, color: INK });
    y -= 26;
  };
  fp('Final SHA-256 Fingerprint (signed content, before this certificate)', input.signedContentSha256);
  fp('Original Document SHA-256 (stage 1, as sent)', input.stage1Sha256);
  fp('Seal Value', input.sealValue);

  // ── Audit trail table ──
  ensure(60);
  y -= 8;
  page.drawText('Audit Trail', { x: M, y, size: 13, font: bold, color: INK });
  y -= 18;

  const cols = [
    { label: 'Event', w: 78 },
    { label: 'Actor Email', w: 165 },
    { label: 'IP Address', w: 102 },
    { label: 'UTC Timestamp', w: contentW - 78 - 165 - 102 },
  ];
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: contentW, height: 20, color: rgb(0.94, 0.96, 0.99) });
    let x = M + 6;
    for (const c of cols) {
      page.drawText(c.label, { x, y, size: 8.5, font: bold, color: MUTED });
      x += c.w;
    }
    y -= 22;
  };
  drawHead();

  for (const ev of input.events) {
    if (y - 30 < 60) {
      ensure(1000);
      drawHead();
    }
    const cells = [EVENT_LABELS[ev.type] ?? ev.type, ev.actorEmail || '-', ev.ipAddress || '-', formatUtc(ev.createdAt)];
    let x = M + 6;
    cells.forEach((cell, i) => {
      page.drawText(truncate(cell, i === 0 ? bold : regular, 8.5, cols[i].w - 8), {
        x,
        y,
        size: 8.5,
        font: i === 0 ? bold : regular,
        color: INK,
      });
      x += cols[i].w;
    });
    y -= 11;
    if (ev.userAgent) {
      page.drawText(truncate(`User-Agent: ${ev.userAgent}`, regular, 6.8, contentW - 84), {
        x: M + 6 + cols[0].w,
        y,
        size: 6.8,
        font: regular,
        color: MUTED,
      });
      y -= 9;
    }
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4[0] - M, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  // ── Closing statement ──
  const statement =
    input.footerNote ??
    `This certificate is an integral part of the sealed document. The SHA-256 fingerprint of the complete sealed file (including this page) is registered in the SignFlow ledger. Upload the file at ${input.verifyUrl} to confirm it is authentic and unmodified. Any alteration changes the fingerprint and will be reported as tampered.`;
  const lines = wrapText(statement, regular, 8.5, contentW);
  ensure(lines.length * 12 + 20);
  y -= 8;
  for (const line of lines) {
    page.drawText(line, { x: M, y, size: 8.5, font: regular, color: MUTED });
    y -= 12;
  }
  footer();
}
