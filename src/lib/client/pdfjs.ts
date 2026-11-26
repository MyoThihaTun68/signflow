'use client';

/* pdf.js is served from /public/pdfjs (copied by scripts/copy-pdfjs.mjs) and
   imported at runtime so the bundler never touches it. */

export interface PdfJsViewport {
  width: number;
  height: number;
}
export interface PdfJsRenderTask {
  promise: Promise<void>;
  cancel(): void;
}
export interface PdfJsPage {
  getViewport(opts: { scale: number }): PdfJsViewport;
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }): PdfJsRenderTask;
  cleanup(): void;
}
export interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
}
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array } | { url: string }): { promise: Promise<PdfJsDocument>; destroy(): Promise<void> };
}

let libPromise: Promise<PdfJsLib> | null = null;

export function getPdfjs(): Promise<PdfJsLib> {
  if (!libPromise) {
    const src = '/pdfjs/pdf.min.mjs';
    libPromise = (import(/* webpackIgnore: true */ src) as Promise<PdfJsLib>).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
    libPromise.catch(() => {
      libPromise = null;
    });
  }
  return libPromise;
}

export async function openPdf(data: Uint8Array): Promise<PdfJsDocument> {
  const lib = await getPdfjs();
  // pdf.js transfers the buffer to its worker, so always pass a copy.
  return lib.getDocument({ data: data.slice() }).promise;
}

/** Rasterises every page of a PDF into JPEG blobs (used by the scanner import). */
export async function rasterizePdf(data: Uint8Array, maxSide = 2000): Promise<Blob[]> {
  const doc = await openPdf(data);
  const out: Blob[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92),
        ),
      );
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
