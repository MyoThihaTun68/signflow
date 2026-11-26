'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCanvas } from '@/lib/client/image';

interface Props {
  open: boolean;
  onClose(): void;
  onCapture(blob: Blob, name: string): void;
}

export function CameraModal({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      setShots(0);
      return;
    }
    let cancelled = false;
    setError(null);
    (async () => {
      stop();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires HTTPS or localhost.');
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open camera.');
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, stop]);

  const snap = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const c = createCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.94));
    if (blob) {
      const next = shots + 1;
      setShots(next);
      onCapture(blob, `Camera ${next}`);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Camera scanner">
        <div className="row-between">
          <div>
            <h2>Camera scanner</h2>
            <p className="muted small">Capture one or more pages. Original colors are preserved.</p>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
              Flip camera ({facing === 'environment' ? 'back' : 'front'})
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Done{shots ? ` (${shots})` : ''}
            </button>
          </div>
        </div>
        {error ? (
          <div className="alert alert-danger">{error}</div>
        ) : (
          <>
            <div className="camera-view">
              <video ref={videoRef} playsInline muted />
              <div className={`flash ${flash ? 'on' : ''}`} />
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="shutter" onClick={snap} aria-label="Take photo" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
