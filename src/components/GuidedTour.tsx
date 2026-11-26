'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface TourStep {
  id: string;
  route: string;
  selector: string;
  badge: string;
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'nav-tabs',
    route: '/',
    selector: '[data-tour="nav-tabs"]',
    badge: 'Step 1 of 7 · Navigation',
    title: 'Four Simple Workspaces',
    body: 'Switch smoothly between Scan & Prepare, Review & Co-Sign, Team Hub (with live red pending count), and Verify PDF. On phones, these move to an iOS bottom tab bar.',
  },
  {
    id: 'scan-flow',
    route: '/',
    selector: '[data-tour="scan-steps"]',
    badge: 'Step 2 of 7 · Scan & Prepare',
    title: 'Simple 3-Step Paper Flow',
    body: 'Upload or photograph paper in 100% original colors, choose which role signs next (Director, Boss, HR, Finance, or + Custom), and click once to send.',
  },
  {
    id: 'scan-dropzone',
    route: '/',
    selector: '[data-tour="scan-dropzone"]',
    badge: 'Step 3 of 7 · Paper Scanner',
    title: 'Drop Photos, PDFs, Paste, or Use Camera',
    body: 'Drop any paper photo or PDF here (or press Ctrl+V). You can also click "Try with 1-Click Sample Paper" below to test Auto-Trim Edges, Rotate, and Crop immediately.',
  },
  {
    id: 'team-tabs',
    route: '/team',
    selector: '[data-tour="team-tabs"]',
    badge: 'Step 4 of 7 · Team Hub',
    title: 'Team Papers, Email Invites & History Log',
    body: 'See every organization paper with a visual trail (From HR → ✓ Director → Next: Boss), invite teammates by email with custom roles, and audit every event in the History Log.',
  },
  {
    id: 'verify-card',
    route: '/verify',
    selector: '[data-tour="verify-card"]',
    badge: 'Step 5 of 7 · Verify PDF',
    title: 'Zero-Knowledge SHA-256 Verification',
    body: 'Drop any PDF to compute its live SHA-256 hash locally via crypto.subtle.digest, or paste a hash below the OR divider. Click "Try sample verified hash" to see a verified match card.',
  },
  {
    id: 'account-menu',
    route: '/verify',
    selector: '[data-tour="account-menu"]',
    badge: 'Step 6 of 7 · Profile & Saved Signature',
    title: 'Sign In & Save Your 1-Click Signature',
    body: 'Create your account once with email & role. When signed in, your name, role, and saved signature load automatically on every paper so you can stamp in 2 seconds.',
  },
  {
    id: 'theme-toggle',
    route: '/verify',
    selector: '[data-tour="theme-toggle"]',
    badge: 'Step 7 of 7 · iOS Themes',
    title: 'iOS Light / Dark Mode & Accent Tints',
    body: 'Tap here anytime to switch between Light, true OLED Dark, or Auto OS mode, and pick from 5 iOS accent colors (Blue, Indigo, Emerald, Amber, Rose).',
  },
];

interface TourCtx {
  active: boolean;
  startTour(startIndex?: number): void;
  closeTour(): void;
}

const Ctx = createContext<TourCtx>({
  active: false,
  startTour: () => undefined,
  closeTour: () => undefined,
});

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = TOUR_STEPS[stepIdx] ?? TOUR_STEPS[0];

  const startTour = useCallback(
    (index = 0) => {
      const target = TOUR_STEPS[index] ?? TOUR_STEPS[0];
      setStepIdx(index);
      setActive(true);
      if (pathname !== target.route) {
        router.push(target.route);
      }
    },
    [pathname, router],
  );

  const closeTour = useCallback(() => {
    setActive(false);
    setRect(null);
  }, []);

  const goToStep = useCallback(
    (nextIdx: number) => {
      if (nextIdx < 0) return;
      if (nextIdx >= TOUR_STEPS.length) {
        closeTour();
        return;
      }
      const target = TOUR_STEPS[nextIdx];
      setStepIdx(nextIdx);
      if (pathname !== target.route) {
        router.push(target.route);
      }
    },
    [pathname, router, closeTour],
  );

  // Locate and spotlight the target element for the current step
  useEffect(() => {
    if (!active) return;

    let rafId = 0;
    let tries = 0;

    const measure = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) {
        if (tries < 25) {
          tries++;
          rafId = window.setTimeout(measure, 120) as unknown as number;
        } else {
          setRect(null);
        }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      const updateBox = () => {
        const r = el.getBoundingClientRect();
        const pad = 8;
        setRect({
          top: Math.max(6, r.top - pad),
          left: Math.max(6, r.left - pad),
          width: Math.min(window.innerWidth - 12, r.width + pad * 2),
          height: r.height + pad * 2,
        });
      };
      updateBox();
      // Re-measure after smooth scroll settles
      rafId = window.setTimeout(updateBox, 320) as unknown as number;
    };

    measure();

    const onResize = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 8;
      setRect({
        top: Math.max(6, r.top - pad),
        left: Math.max(6, r.left - pad),
        width: Math.min(window.innerWidth - 12, r.width + pad * 2),
        height: r.height + pad * 2,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTour();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') goToStep(stepIdx + 1);
      else if (e.key === 'ArrowLeft') goToStep(stepIdx - 1);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, step, pathname, stepIdx, goToStep, closeTour]);

  // Compute smart popup position (below spotlight if space, otherwise above, clamped to viewport)
  const popupStyle = (): React.CSSProperties => {
    if (typeof window === 'undefined' || !rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const cardW = Math.min(380, window.innerWidth - 28);
    const estH = 215;
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const top =
      spaceBelow >= estH + 20
        ? rect.top + rect.height + 14
        : Math.max(16, rect.top - estH - 14);
    const idealLeft = rect.left + rect.width / 2 - cardW / 2;
    const left = Math.min(Math.max(14, idealLeft), window.innerWidth - cardW - 14);
    return { top, left, width: cardW };
  };

  return (
    <Ctx.Provider value={{ active, startTour, closeTour }}>
      {children}

      {active && (
        <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Interactive feature tour">
          {/* Backdrop click dismisses tour */}
          <div className="tour-backdrop" onClick={closeTour} />

          {/* Glowing Spotlight Cutout around the highlighted element */}
          {rect && (
            <div
              className="tour-spotlight"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              }}
            />
          )}

          {/* Frosted iOS Explanation Popup Card */}
          <div className="tour-popover stack-sm" style={popupStyle()} onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <span className="badge badge-primary">{step.badge}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={closeTour} aria-label="Close tour">
                ✕
              </button>
            </div>
            <h3 style={{ fontSize: '1.05rem', marginTop: 2 }}>{step.title}</h3>
            <p className="small muted" style={{ lineHeight: 1.55 }}>
              {step.body}
            </p>

            {/* Step dots */}
            <div className="tour-dots" aria-hidden>
              {TOUR_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`tour-dot ${i === stepIdx ? 'active' : ''}`}
                  onClick={() => goToStep(i)}
                  title={s.title}
                />
              ))}
            </div>

            <div className="row-between" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={stepIdx === 0}
                onClick={() => goToStep(stepIdx - 1)}
              >
                ← Back
              </button>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={closeTour}>
                  Skip
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => goToStep(stepIdx + 1)}
                >
                  {stepIdx === TOUR_STEPS.length - 1 ? 'Done ✓' : 'Next →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useGuidedTour() {
  return useContext(Ctx);
}
