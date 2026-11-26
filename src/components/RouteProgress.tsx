'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

function RouteProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const finishRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (finishRef.current) clearTimeout(finishRef.current);
    timerRef.current = null;
    finishRef.current = null;
  };

  // Start the sleek top loading bar immediately on any internal link click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || anchor.target === '_blank' || anchor.download) {
        return;
      }
      if (href === pathname) return;

      clearTimers();
      setVisible(true);
      setProgress(18);
      timerRef.current = window.setInterval(() => {
        setProgress((p) => (p >= 86 ? p : p + Math.max(2, (88 - p) * 0.14)));
      }, 140);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimers();
    };
  }, [pathname]);

  // Complete the bar smoothly whenever the route finishes changing
  useEffect(() => {
    clearTimers();
    if (visible) {
      setProgress(100);
      finishRef.current = window.setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 260);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  if (!visible) return null;
  return (
    <div className="route-progress" aria-hidden="true">
      <div className="route-progress-bar" style={{ width: `${progress}%` }} />
    </div>
  );
}

export function RouteProgressBar() {
  return (
    <Suspense fallback={null}>
      <RouteProgressInner />
    </Suspense>
  );
}

/** Smoothly fades & lifts page content in on every route transition */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
