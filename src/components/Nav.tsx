'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ backend, mail }: { backend: 'supabase' | 'local'; mail: 'resend' | 'smtp' | 'console' }) {
  const pathname = usePathname() || '/';
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" aria-label="SignFlow home">
          <span className="brand-mark" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 17c3-4 5-9 7-9s-1 9 2 9 3-5 5-5 2 3 4 3" />
            </svg>
          </span>
          SignFlow
        </Link>
        <nav className="tabs" aria-label="Sections">
          <Link href="/" className={`tab ${pathname === '/' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10" />
            </svg>
            Scan &amp; Prepare
          </Link>
          <Link href="/sign" className={`tab ${pathname.startsWith('/sign') ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Review &amp; Co-Sign
          </Link>
          <Link href="/verify" className={`tab ${pathname.startsWith('/verify') ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Zm-2.5 9 2 2 4-4" />
            </svg>
            Verify PDF
          </Link>
        </nav>
        <div className="env-badges">
          <span
            className={`badge ${backend === 'supabase' ? 'badge-ok' : 'badge-muted'}`}
            title={backend === 'supabase' ? 'Connected to Supabase PostgreSQL + Storage' : 'Using local .data fallback'}
          >
            <span className="badge-dot" />
            {backend === 'supabase' ? 'Supabase Live' : 'Local Storage'}
          </span>
          <span
            className={`badge ${mail === 'console' ? 'badge-warn' : 'badge-primary'}`}
            title={
              mail === 'console'
                ? 'Development mode: OTP codes appear on screen and in terminal'
                : `Emails delivered via ${mail.toUpperCase()}`
            }
          >
            {mail === 'console' ? 'OTP: On-Screen Demo' : `Mail: ${mail.toUpperCase()}`}
          </span>
        </div>
      </div>
    </header>
  );
}
