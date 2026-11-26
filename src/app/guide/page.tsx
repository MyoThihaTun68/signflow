'use client';

import Link from 'next/link';
import { useState } from 'react';

interface FeatureGuide {
  id: string;
  number: string;
  badge: string;
  title: string;
  summary: string;
  href: string;
  cta: string;
  steps: { heading: string; detail: string }[];
  tips: string[];
}

const FEATURES: FeatureGuide[] = [
  {
    id: 'accounts',
    number: '01',
    badge: 'Team Setup',
    title: 'Accounts, Custom Roles & Email Invites',
    summary:
      'Connect your entire organization (HR, Director, Boss, Finance, or any custom role you create) so every team member has their own identity and 1-click saved signature.',
    href: '/team',
    cta: 'Open Team Hub →',
    steps: [
      {
        heading: 'First-Time Account Creation',
        detail:
          'Click "Sign In" in the top-right header, switch to "First-Time Create Account", enter your Name, Role (or click "+ Custom" to type your own role like Legal or CEO), Email, and Password.',
      },
      {
        heading: 'Returning Sign-In',
        detail:
          'Next time you open SignFlow, just sign in with your Email & Password. Your name, role, and saved signature automatically fill across all pages.',
      },
      {
        heading: 'Invite Teammates by Email',
        detail:
          'Inside Team Hub → "Team & Email Invites", enter a teammate’s Name, Email, and Role and click "+ Send Email Invite & Copy Link". Opening that personal link pre-fills their profile so they only need to choose a password.',
      },
    ],
    tips: [
      'Click "+ Custom" on any role selector to add custom roles like Legal, Accounting, or Chairman.',
      'Your session stays securely signed in for 14 days via an HttpOnly HMAC-signed cookie.',
    ],
  },
  {
    id: 'scanner',
    number: '02',
    badge: 'Scan & Prepare',
    title: 'Paper-to-Digital Scanner (100% Original Colors)',
    summary:
      'Turn physical paper photos or existing PDFs into clean, lightweight digital PDFs without ever washing out ink colors or company stamps.',
    href: '/',
    cta: 'Open Scan & Prepare →',
    steps: [
      {
        heading: 'Capture or Drop Pages',
        detail:
          'Drop JPG/PNG photos or PDF files, paste a screenshot directly with Ctrl+V, tap "Take Photo with Camera" (front/back flip), or click "Try with 1-Click Sample Paper".',
      },
      {
        heading: 'Auto-Trim & Straighten',
        detail:
          'Click "Auto-Trim Edges" to snap the 4-corner crop box to the paper boundary automatically. Drag any corner or edge handle for fine control, or rotate -90° / +90°.',
      },
      {
        heading: 'Optional Fine Tools',
        detail:
          'Click "Fine Tilt / Page Size" whenever you need -15° to +15° tilt straightening with an alignment grid, Flip H, or A4 / US Letter / Original Ratio page sizing.',
      },
      {
        heading: 'Route to Your Team',
        detail:
          'Enter the Paper Name, pick who should sign next (Director, Boss, HR, Finance, or Custom Role), and click "Send for Signing →". Every page is compressed to ≤1400 px (0.82 JPEG) to keep files fast and small.',
      },
    ],
    tips: [
      'Original paper and ink colors are 100% preserved — no destructive black-and-white filters.',
      'You can also click "Or Just Download Clean PDF" to use SignFlow as a standalone paper scanner.',
    ],
  },
  {
    id: 'cosign',
    number: '03',
    badge: 'Review & Co-Sign',
    title: 'Pure Ink Signature Stamping (Zero Extra Clutter)',
    summary:
      'Stamp your pure drawn, typed, or photo-scanned signature directly on top of the original PDF background — no extra pages added and no ugly email text stamped over your paper.',
    href: '/sign',
    cta: 'Open Review & Co-Sign →',
    steps: [
      {
        heading: 'Draw, Type, or Photo-Scan Your Signature',
        detail:
          'Use smooth Bézier drawing (with Undo, Fine/Medium/Bold stroke, and 4 ink colors), Type with cursive fonts, or upload a Photo Scan of your wet-ink signature on paper (automatically strips the paper background to a transparent PNG).',
      },
      {
        heading: 'Save Signature to Your Profile (1-Click Stamp)',
        detail:
          'While signed in, click "★ Save to My Profile". Next time you open any paper, your signature loads automatically so you only tap the page and click Complete.',
      },
      {
        heading: 'Place, Resize Directly, or Add Multiple Stamps',
        detail:
          'Click anywhere on the PDF page (or tap Left / Center / Right) to position your stamp. Drag the blue corner dot right on the paper to resize, or click "+ Add Stamp" to stamp multiple pages/spots at once.',
      },
      {
        heading: 'Chain Forwarding (HR → Director → Boss)',
        detail:
          'Choose "✓ Finish & Complete" to lock the final PDF, or choose "→ Next: Boss" to embed your stamp now and immediately pass the paper to the Boss so they see your stamp already on the page.',
      },
    ],
    tips: [
      'Internal team members sign instantly with zero OTP friction.',
      'Original PDF page count and background remain 100% intact (only pure transparent signature ink is embedded).',
    ],
  },
  {
    id: 'chat',
    number: '04',
    badge: 'Collaboration',
    title: 'Live Team Discussion & Traceable History Log',
    summary:
      'HR, Director, and Boss can talk directly on any paper and trace who prepared, viewed, commented, forwarded, and signed every document.',
    href: '/team',
    cta: 'View Team Papers & Logs →',
    steps: [
      {
        heading: 'Document-Specific Team Chat',
        detail:
          'Scroll below the PDF preview on any signing page to write messages (e.g. "@Director please check clause 3 before forwarding to Boss"). Every message is tagged with the author’s Role, Name, and UTC time.',
      },
      {
        heading: 'Visual Approval Chain in Team Hub',
        detail:
          'Every paper in Team Hub displays a clear pill trail: "From HR → ✓ Director Signed → Next: Boss", with a red notification count in the navigation bar showing papers waiting for your role.',
      },
      {
        heading: 'Chronological Audit Trail',
        detail:
          'Open the "History Log" tab in Team Hub (or click "View Full History Log" on any paper) to trace every event with Role, Email, IP address, and exact UTC timestamp.',
      },
    ],
    tips: [
      'After completing one paper, click "Next Pending Paper →" to approve multiple documents back-to-back.',
    ],
  },
  {
    id: 'verify',
    number: '05',
    badge: 'Verify PDF',
    title: 'Zero-Knowledge SHA-256 PDF Verification',
    summary:
      'Prove mathematically that any PDF is authentic and unmodified — even a single changed pixel or character is instantly detected as TAMPERED.',
    href: '/verify',
    cta: 'Open Verify PDF →',
    steps: [
      {
        heading: 'Drop a PDF or Paste a Hash',
        detail:
          'Drop any PDF file into the Verify PDF card (or click "Browse PDF File"). Your browser computes its exact 64-character SHA-256 fingerprint locally using crypto.subtle.digest — the file never leaves your device.',
      },
      {
        heading: 'Check Against the Cryptographic Ledger',
        detail:
          'SignFlow compares the hash against both stage1_sha256 (original scan) and final_sha256 (signed PDF) stored in Supabase.',
      },
      {
        heading: 'Read the Verdict & Export Audit JSON',
        detail:
          'See "VERIFIED — Authentic & Unmodified" with the complete audit timeline (plus an Export JSON button), "TAMPERED — Hash Mismatch", or "UNREGISTERED".',
      },
    ],
    tips: [
      'Click "✦ Try sample verified hash" on the Verify page to preview a live verified ledger match anytime.',
    ],
  },
  {
    id: 'theme',
    number: '06',
    badge: 'iOS Experience',
    title: 'iOS Minimalist Themes, Dark Mode & Mobile Bar',
    summary:
      'Designed with frosted Cupertino glass, spring animations, OLED Dark Mode, custom accent tints, and a thumb-friendly mobile bottom tab bar.',
    href: '/',
    cta: 'Try Theme Control (Top-Right) ↑',
    steps: [
      {
        heading: 'Switch Light / Dark / Auto Mode',
        detail:
          'Click the Sun/Moon circle button in the top-right header to pick Light, true OLED Dark, or Auto (syncs with your Mac, Windows, iOS, or Android OS theme without any white flash).',
      },
      {
        heading: 'Customize Accent Tint',
        detail:
          'Pick from 5 iOS accent colors (Blue, Indigo, Emerald, Amber, Rose) to re-theme buttons, active tabs, sliders, and crop handles across the entire app.',
      },
      {
        heading: 'Mobile & Laos-Ready Access',
        detail:
          'On phones, navigation shifts to a frosted iOS bottom tab bar. Hosted behind Cloudflare Workers edge in Vientiane so your entire team in Laos opens links fast with zero VPN.',
      },
    ],
    tips: [
      'Your signature drawing pad always keeps a crisp white paper background even in Dark Mode so ink contrast stays accurate.',
    ],
  },
];

export default function GuidePage() {
  const [activeId, setActiveId] = useState<string>('all');

  const visibleFeatures = activeId === 'all' ? FEATURES : FEATURES.filter((f) => f.id === activeId);

  return (
    <div className="focal-3xl stack">
      {/* ── Centered Header ── */}
      <div className="verify-head">
        <span className="badge badge-primary" style={{ marginBottom: 10 }}>
          SignFlow Manual · 1-by-1 Feature Guide
        </span>
        <h1>How SignFlow Works</h1>
        <p className="muted">
          A clear, step-by-step guide to every feature — from scanning paper in full color to team signing (HR →
          Director → Boss) and cryptographic SHA-256 verification.
        </p>
      </div>

      {/* ── 30-Second Quick Flow Overview Card ── */}
      <div className="card card-hero stack">
        <div className="row-between">
          <h2>The Complete Workflow in 4 Steps</h2>
          <span className="badge badge-ok">Zero VPN · Supabase Live</span>
        </div>
        <div className="guide-flow-grid">
          <div className="guide-flow-step">
            <span className="guide-step-num">1</span>
            <strong>Scan / Upload</strong>
            <span className="small muted">Photo or PDF in 100% original colors</span>
          </div>
          <div className="guide-flow-step">
            <span className="guide-step-num">2</span>
            <strong>Route to Role</strong>
            <span className="small muted">Pick Director, Boss, HR, or Custom Role</span>
          </div>
          <div className="guide-flow-step">
            <span className="guide-step-num">3</span>
            <strong>Tap &amp; Stamp</strong>
            <span className="small muted">Pure ink stamp, chat &amp; forward chain</span>
          </div>
          <div className="guide-flow-step">
            <span className="guide-step-num">4</span>
            <strong>Verify Anytime</strong>
            <span className="small muted">SHA-256 proof + full audit history</span>
          </div>
        </div>
      </div>

      {/* ── Quick Jump / Filter Pills ── */}
      <div className="seg full" role="tablist" aria-label="Filter guide by feature">
        <button type="button" className={activeId === 'all' ? 'active' : ''} onClick={() => setActiveId('all')}>
          All 6 Features
        </button>
        {FEATURES.map((f) => (
          <button
            key={f.id}
            type="button"
            className={activeId === f.id ? 'active' : ''}
            onClick={() => setActiveId(f.id)}
          >
            {f.number}. {f.badge}
          </button>
        ))}
      </div>

      {/* ── 1-by-1 Feature Cards ── */}
      <div className="stack">
        {visibleFeatures.map((f) => (
          <section key={f.id} id={f.id} className="card stack">
            <div className="row-between">
              <div className="row">
                <span className="guide-step-num">{f.number}</span>
                <div>
                  <span className="badge badge-primary" style={{ marginBottom: 4 }}>
                    {f.badge}
                  </span>
                  <h2>{f.title}</h2>
                </div>
              </div>
              <Link href={f.href} className="btn btn-sm btn-primary">
                {f.cta}
              </Link>
            </div>

            <p className="muted">{f.summary}</p>

            <div className="stack-sm">
              {f.steps.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontWeight: 650, fontSize: '0.92rem', marginBottom: 3 }}>
                    {idx + 1}. {s.heading}
                  </div>
                  <p className="small muted">{s.detail}</p>
                </div>
              ))}
            </div>

            {f.tips.length > 0 && (
              <div className="alert alert-info stack-sm">
                <strong style={{ fontSize: '0.82rem' }}>Pro Tips</strong>
                {f.tips.map((tip, i) => (
                  <span key={i} className="small">
                    • {tip}
                  </span>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* ── Quick Start Footer CTA ── */}
      <div className="card row-between">
        <div>
          <h3>Ready to try it yourself?</h3>
          <p className="muted small">
            Start by loading our 1-click Sample Paper Contract or inviting your team in Team Hub.
          </p>
        </div>
        <div className="row">
          <Link href="/team" className="btn">
            Open Team Hub
          </Link>
          <Link href="/" className="btn btn-primary">
            Start Scanning →
          </Link>
        </div>
      </div>
    </div>
  );
}
