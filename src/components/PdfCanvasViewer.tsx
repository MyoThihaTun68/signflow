'use client';

import { useEffect, useRef, useState } from 'react';
import { openPdf, type PdfJsDocument, type PdfJsRenderTask } from '@/lib/client/pdfjs';

export interface StampOverlay {
  id?: string;
  page: number;
  cx: number;
  cy: number;
  widthFrac: number;
  png: string;
  caption?: string;
  captionColor?: string;
}

interface Props {
  data: Uint8Array | null;
  page: number;
  onPageChange(page: number): void;
  onPageCount?(count: number): void;
  /** Single stamp (legacy) */
  stamp?: StampOverlay | null;
  /** Multiple stamps across pages */
  stamps?: StampOverlay[];
  activeStampId?: string | null;
  onSelectStamp?(id: string): void;
  onRemoveStamp?(id: string): void;
  interactive?: boolean;
  onPlace?(page: number, cx: number, cy: number, stampId?: string): void;
  onResize?(widthFrac: number, stampId?: string): void;
}

export function PdfCanvasViewer({
  data,
  page,
  onPageChange,
  onPageCount,
  stamp,
  stamps,
  activeStampId,
  onSelectStamp,
  onRemoveStamp,
  interactive,
  onPlace,
  onResize,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pageBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfJsDocument | null>(null);
  const taskRef = useRef<PdfJsRenderTask | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [boxWidth, setBoxWidth] = useState(760);
  const [zoom, setZoom] = useState(1);
  const [pageCss, setPageCss] = useState<{ w: number; h: number }>({ w: 600, h: 800 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allStamps: StampOverlay[] = stamps ?? (stamp ? [stamp] : []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setBoxWidth(Math.max(260, Math.min(960, w - 36)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNumPages(0);
    if (!data) return;
    setLoading(true);
    openPdf(data)
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current?.destroy();
        docRef.current = doc;
        setNumPages(doc.numPages);
        onPageCount?.(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF could not be opened.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || numPages === 0) return;
    const safePage = Math.min(Math.max(0, page), numPages - 1);
    let cancelled = false;
    (async () => {
      try {
        taskRef.current?.cancel();
        const pdfPage = await doc.getPage(safePage + 1);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const cssW = Math.min(boxWidth, 920) * zoom;
        const cssScale = cssW / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const cssH = Math.round(base.height * cssScale);
        canvas.style.width = `${Math.round(cssW)}px`;
        canvas.style.height = `${cssH}px`;
        setPageCss({ w: Math.round(cssW), h: cssH });
        const task = pdfPage.render({ canvasContext: canvas.getContext('2d')!, viewport });
        taskRef.current = task;
        await task.promise;
      } catch {
        // cancelled render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, numPages, boxWidth, zoom]);

  const placeAtClient = (clientX: number, clientY: number, stampId?: string) => {
    if (!interactive || !onPlace || !pageBoxRef.current) return;
    const r = pageBoxRef.current.getBoundingClientRect();
    const cx = Math.min(0.95, Math.max(0.05, (clientX - r.left) / r.width));
    const cy = Math.min(0.95, Math.max(0.05, (clientY - r.top) / r.height));
    onPlace(page, cx, cy, stampId);
  };

  const draggingId = useRef<string | null>(null);
  const resizingRef = useRef<{ id?: string; startX: number; startW: number } | null>(null);

  return (
    <div className="pdf-viewer" ref={wrapRef}>
      {numPages > 0 && (
        <div className="pdf-toolbar">
          <div className="pager">
            <button type="button" className="btn btn-sm" disabled={page <= 0} onClick={() => onPageChange(page - 1)}>
              ← Prev
            </button>
            <div className="pdf-thumbs" aria-label="Jump to page">
              {Array.from({ length: numPages }, (_, i) => {
                const countOnPage = allStamps.filter((s) => s.page === i).length;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pdf-thumb-pill ${page === i ? 'active' : ''}`}
                    onClick={() => onPageChange(i)}
                  >
                    {i + 1}
                    {countOnPage > 0 ? ` ✦${countOnPage > 1 ? countOnPage : ''}` : ''}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={page >= numPages - 1}
              onClick={() => onPageChange(page + 1)}
            >
              Next →
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={zoom <= 0.75}
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
              title="Zoom out"
            >
              −
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setZoom(1)} title="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={zoom >= 1.75}
              onClick={() => setZoom((z) => Math.min(1.75, Number((z + 0.15).toFixed(2))))}
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="pdf-stage">
        {error ? (
          <div className="alert alert-danger">{error}</div>
        ) : !data || loading ? (
          <div className="pdf-loading">
            <span className="row">
              <span className="spinner" /> Rendering PDF canvas...
            </span>
          </div>
        ) : (
          <div
            ref={pageBoxRef}
            className={`pdf-page ${interactive ? 'placing' : ''}`}
            style={{ width: pageCss.w, height: pageCss.h }}
            onClick={(e) => placeAtClient(e.clientX, e.clientY, activeStampId ?? undefined)}
          >
            <canvas ref={canvasRef} />
            {allStamps
              .filter((s) => s.page === page)
              .map((s, idx) => {
                const sid = s.id ?? `stamp-${idx}`;
                const isSelected = !activeStampId || activeStampId === sid;
                return (
                  <div
                    key={sid}
                    className={`pdf-stamp ${isSelected ? 'selected' : ''}`}
                    style={{
                      left: `${s.cx * 100}%`,
                      top: `${s.cy * 100}%`,
                      width: `${s.widthFrac * 100}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectStamp?.(sid);
                    }}
                    onPointerDown={(e) => {
                      if (!interactive) return;
                      e.stopPropagation();
                      onSelectStamp?.(sid);
                      e.currentTarget.setPointerCapture(e.pointerId);
                      draggingId.current = sid;
                    }}
                    onPointerMove={(e) => {
                      if (draggingId.current === sid) placeAtClient(e.clientX, e.clientY, sid);
                    }}
                    onPointerUp={() => {
                      draggingId.current = null;
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.png} alt="Signature stamp" />
                    {s.caption && (
                      <span className="pdf-stamp-label" style={{ color: s.captionColor }}>
                        {s.caption}
                      </span>
                    )}

                    {/* Direct Corner Resize Handle (drag bottom-right dot directly on paper) */}
                    {interactive && onResize && (
                      <span
                        className="stamp-resize-dot"
                        title="Drag corner to resize signature"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          resizingRef.current = { id: sid, startX: e.clientX, startW: s.widthFrac };
                        }}
                        onPointerMove={(e) => {
                          const r = resizingRef.current;
                          if (!r || r.id !== sid || !pageBoxRef.current) return;
                          e.stopPropagation();
                          const pageW = pageBoxRef.current.getBoundingClientRect().width || 600;
                          const deltaFrac = ((e.clientX - r.startX) / pageW) * 2;
                          const nextW = Math.min(0.6, Math.max(0.08, r.startW + deltaFrac));
                          onResize(nextW, sid);
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          resizingRef.current = null;
                        }}
                      />
                    )}

                    {/* Remove Stamp button when multiple stamps exist */}
                    {interactive && onRemoveStamp && allStamps.length > 1 && (
                      <button
                        type="button"
                        className="stamp-delete-dot"
                        title="Remove this stamp"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveStamp(sid);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
