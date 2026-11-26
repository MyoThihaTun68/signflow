'use client';

import { PDFDocument } from 'pdf-lib';
import { dataUrlToBytes, drawStamp } from '@/lib/pdf/stamp';
import type { PageOutput } from './image';

export interface Signer1Mark {
  png: string;
  name: string;
  position: 'bl' | 'br';
}

/** Builds the stage-1 PDF from rendered scanner pages. */
export async function buildScanPdf(pages: PageOutput[], title: string, mark: Signer1Mark | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const p of pages) {
    const image = p.format === 'png' ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
    const page = pdf.addPage([p.wPt, p.hPt]);
    page.drawImage(image, { x: 0, y: 0, width: p.wPt, height: p.hPt });
  }
  if (mark && pdf.getPageCount() > 0) {
    await drawStamp(
      pdf,
      pdf.getPageCount() - 1,
      dataUrlToBytes(mark.png),
      { cx: mark.position === 'bl' ? 0.2 : 0.8, cy: 0.86, widthFrac: 0.24 },
      [],
    );
  }
  pdf.setTitle(title || 'Scanned document');
  pdf.setProducer('SignFlow (pdf-lib)');
  pdf.setCreator('SignFlow Scanner');
  return pdf.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'document'
  );
}
