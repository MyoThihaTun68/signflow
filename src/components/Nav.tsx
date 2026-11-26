'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { roleLabel } from '@/lib/types';

type SchemeMode = 'system' | 'light' | 'dark';
type AccentId = 'blue' | 'indigo' | 'emerald' | 'amber' | 'rose';

const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'blue', label: 'iOS Blue', color: '#007aff' },
  { id: 'indigo', label: 'Indigo', color: '#5856d6' },
  { id: 'emerald', label: 'Emerald', color: '#34c759' },
  { id: 'amber', label: 'Amber', color: '#ff9500' },
  { id: 'rose', label: 'Rose', color: '#ff2d55' },
];

function applyMetaColorScheme(mode: SchemeMode) {
  let meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  meta.content = mode === 'system' ? 'light dark' : mode;
}

export function Nav() {
  const pathname = usePathname() || '/';
  const { user, openAuthModal, logout } = useAuth();
  const [scheme, setScheme] = useState<SchemeMode>('system');
  const [sysDark, setSysDark] = useState(false);
  const [accent, setAccent] = useState<AccentId>('blue');
  const [openTheme, setOpenTheme] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const themeRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  // Live "Waiting for Me" notification badge count on Team Hub
  useEffect(() => {
    let cancelled = false;
    const loadCount = () => {
      fetch('/api/team', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !Array.isArray(data?.documents)) return;
          const docs = data.documents as { status: string; assignedRole?: string }[];
          const pending = docs.filter((d) => {
            if (d.status !== 'pending_cosign') return false;
            if (!user) return true;
            return (d.assignedRole || '').toLowerCase() === user.role.toLowerCase();
          });
          setPendingCount(pending.length);
        })
        .catch(() => undefined);
    };
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, pathname]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('color-scheme');
      if (saved === 'light' || saved === 'dark') {
        setScheme(saved);
        applyMetaColorScheme(saved);
      } else {
        setScheme('system');
        applyMetaColorScheme('system');
      }
      const savedAccent = localStorage.getItem('sf-accent') as AccentId | null;
      if (savedAccent && ACCENTS.some((a) => a.id === savedAccent)) {
        setAccent(savedAccent);
        document.documentElement.dataset.accent = savedAccent;
      }
    } catch {
      // ignore
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSysDark(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onMq);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next: SchemeMode = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system';
        setScheme(next);
        applyMetaColorScheme(next);
      } else if (e.key === 'sf-accent' && e.newValue) {
        setAccent(e.newValue as AccentId);
        document.documentElement.dataset.accent = e.newValue;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!openTheme && !openProfile) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (openTheme && themeRef.current && !themeRef.current.contains(target)) setOpenTheme(false);
      if (openProfile && profileRef.current && !profileRef.current.contains(target)) setOpenProfile(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenTheme(false);
        setOpenProfile(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [openTheme, openProfile]);

  const selectScheme = (next: SchemeMode) => {
    setScheme(next);
    applyMetaColorScheme(next);
    try {
      if (next === 'system') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', next);
    } catch {
      // ignore
    }
  };

  const selectAccent = (next: AccentId) => {
    setAccent(next);
    document.documentElement.dataset.accent = next;
    try {
      if (next === 'blue') localStorage.removeItem('sf-accent');
      else localStorage.setItem('sf-accent', next);
    } catch {
      // ignore
    }
  };

  const resolvedDark = scheme === 'dark' || (scheme === 'system' && sysDark);
  const initials = user
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';

  return (
    <>
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
            <Link href="/team" className={`tab ${pathname.startsWith('/team') ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Team Hub
              {pendingCount > 0 && (
                <span className="nav-notif-pill" title={`${pendingCount} paper(s) waiting for signature`}>
                  {pendingCount}
                </span>
              )}
            </Link>
            <Link href="/verify" className={`tab ${pathname.startsWith('/verify') ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Zm-2.5 9 2 2 4-4" />
              </svg>
              Verify PDF
            </Link>
          </nav>

          {/* Clean Right Header: Single Profile Dropdown + Appearance Toggle */}
          <div className="env-badges">
            {user ? (
              <div className="theme-menu-wrap" ref={profileRef}>
                <button
                  type="button"
                  className={`profile-pill ${openProfile ? 'active' : ''}`}
                  onClick={() => {
                    setOpenProfile((v) => !v);
                    setOpenTheme(false);
                  }}
                  aria-expanded={openProfile}
                  aria-label="Account menu"
                >
                  <span className="profile-avatar">{initials}</span>
                  <span className="profile-name">{user.name.split(' (')[0]}</span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {openProfile && (
                  <div className="theme-popover profile-popover" role="menu">
                    <div className="profile-popover-head">
                      <span className="profile-avatar lg">{initials}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 680, fontSize: '0.92rem' }}>{user.name}</div>
                        <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {user.email}
                        </div>
                        <span className="badge badge-primary" style={{ marginTop: 4 }}>
                          {roleLabel(user.role)}
                        </span>
                      </div>
                    </div>
                    <hr className="divider" style={{ margin: '10px 0' }} />
                    <div className="stack-sm">
                      <Link
                        href="/team"
                        className="btn btn-sm btn-ghost"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => setOpenProfile(false)}
                      >
                        Team Hub &amp; Invites
                      </Link>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => {
                          setOpenProfile(false);
                          logout();
                        }}
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => openAuthModal('login')}
              >
                Sign In
              </button>
            )}

            {/* iOS Minimalist Appearance & Theme Control Center */}
            <div className="theme-menu-wrap" ref={themeRef}>
              <button
                type="button"
                className={`theme-trigger ${openTheme ? 'active' : ''}`}
                onClick={() => {
                  setOpenTheme((v) => !v);
                  setOpenProfile(false);
                }}
                aria-expanded={openTheme}
                aria-label="Appearance and iOS Theme settings"
                title="Appearance & Accent Theme"
              >
                {resolvedDark ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
                  </svg>
                )}
                <span className="theme-trigger-dot" />
              </button>

              {openTheme && (
                <div className="theme-popover" role="dialog" aria-label="Appearance settings">
                  <div className="theme-popover-title">Appearance</div>
                  <div className="seg full">
                    <button
                      type="button"
                      className={scheme === 'light' ? 'active' : ''}
                      onClick={() => selectScheme('light')}
                    >
                      ☀ Light
                    </button>
                    <button
                      type="button"
                      className={scheme === 'dark' ? 'active' : ''}
                      onClick={() => selectScheme('dark')}
                    >
                      ☾ Dark
                    </button>
                    <button
                      type="button"
                      className={scheme === 'system' ? 'active' : ''}
                      onClick={() => selectScheme('system')}
                      title={`System (currently ${sysDark ? 'Dark' : 'Light'})`}
                    >
                      Auto ({sysDark ? 'Dark' : 'Light'})
                    </button>
                  </div>

                  <div className="theme-popover-title" style={{ marginTop: 10 }}>
                    iOS Accent Tint
                  </div>
                  <div className="accent-row">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`accent-pill ${accent === a.id ? 'active' : ''}`}
                        onClick={() => selectAccent(a.id)}
                        title={a.label}
                      >
                        <span className="accent-circle" style={{ background: a.color }} />
                        <span>{a.label.replace('iOS ', '')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Frosted iOS Bottom Tab Bar for Mobile Devices (< 720px) */}
      <nav className="mobile-tabbar" aria-label="Mobile navigation">
        <Link href="/" className={`m-tab ${pathname === '/' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10" />
          </svg>
          <span>Scan</span>
        </Link>
        <Link href="/sign" className={`m-tab ${pathname.startsWith('/sign') ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>Sign</span>
        </Link>
        <Link href="/team" className={`m-tab ${pathname.startsWith('/team') ? 'active' : ''}`}>
          <span className="m-tab-icon-wrap">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {pendingCount > 0 && <span className="m-tab-badge">{pendingCount}</span>}
          </span>
          <span>Team</span>
        </Link>
        <Link href="/verify" className={`m-tab ${pathname.startsWith('/verify') ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Zm-2.5 9 2 2 4-4" />
          </svg>
          <span>Verify</span>
        </Link>
      </nav>
    </>
  );
}
