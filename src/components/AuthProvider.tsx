'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { RolePicker } from '@/components/RolePicker';
import { useToast } from '@/components/Toast';
import { roleLabel, type OrgRole, type TeamMember } from '@/lib/types';

interface InviteInfo {
  email: string;
  name: string;
  role: OrgRole;
  department: string;
}

interface AuthContextValue {
  user: TeamMember | null;
  roster: TeamMember[];
  loading: boolean;
  openAuthModal(mode?: 'login' | 'register', prefill?: Partial<InviteInfo> & { inviteToken?: string }): void;
  logout(): Promise<void>;
  refreshAuth(): Promise<void>;
  saveSignature(png: string | null): Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  roster: [],
  loading: true,
  openAuthModal: () => undefined,
  logout: async () => undefined,
  refreshAuth: async () => undefined,
  saveSignature: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [user, setUser] = useState<TeamMember | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [inviteToken, setInviteToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrgRole>('hr');
  const [department, setDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openAuthModal = useCallback(
    (
      initialMode: 'login' | 'register' = 'login',
      prefill?: Partial<InviteInfo> & { inviteToken?: string },
    ) => {
      setMode(initialMode);
      setErr(null);
      setPassword('');
      if (prefill?.email) setEmail(prefill.email);
      if (prefill?.name) setName(prefill.name);
      if (prefill?.role) setRole(prefill.role);
      if (prefill?.department) setDepartment(prefill.department);
      if (prefill?.inviteToken) setInviteToken(prefill.inviteToken);
      setModalOpen(true);
    },
    [],
  );

  const refreshAuth = useCallback(async () => {
    try {
      const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const inv = params.get('invite');
      const url = inv ? `/api/auth?invite=${encodeURIComponent(inv)}` : '/api/auth';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setUser(data.user ?? null);
      setRoster(data.roster ?? []);

      if (data.invite && inv) {
        const info = data.invite as InviteInfo;
        setMode('register');
        setErr(null);
        setPassword('');
        setEmail(info.email || '');
        setName(info.name || '');
        setRole(info.role || 'director');
        setDepartment(info.department || '');
        setInviteToken(inv);
        if (data.user) {
          setModalOpen(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setUser(null);
    toast('Signed out', 'info');
  }, [toast]);

  const saveSignature = useCallback(
    async (png: string | null) => {
      if (!user) return;
      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_signature', signature: png }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) setUser(data.user);
          toast(png ? 'Signature saved to your profile for 1-click stamping!' : 'Saved signature cleared', 'ok');
        }
      } catch {
        toast('Could not save signature', 'err');
      }
    },
    [user, toast],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          department: department.trim() || roleLabel(role),
          inviteToken: inviteToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed.');
      setUser(data.user);
      if (data.roster) setRoster(data.roster);
      setModalOpen(false);
      setInviteToken('');
      setPassword('');
      if (typeof window !== 'undefined' && window.location.search.includes('invite=')) {
        const u = new URL(window.location.href);
        u.searchParams.delete('invite');
        window.history.replaceState({}, '', u.pathname + u.search + u.hash);
      }
      toast(
        mode === 'register'
          ? `Account created! Signed in as ${data.user.name} (${roleLabel(data.user.role)})`
          : `Welcome back, ${data.user.name}!`,
        'ok',
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const authFormContent = (
    <>
      <div className="seg full">
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => {
            setMode('login');
            setErr(null);
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          className={mode === 'register' ? 'active' : ''}
          onClick={() => {
            setMode('register');
            setErr(null);
          }}
        >
          Create Account
        </button>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {mode === 'register' && (
          <>
            <label className="field">
              <span>Your Full Name</span>
              <input
                className="input"
                required
                placeholder="e.g. Khamla Vongsa"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="field">
              <span>Your Role (or click + Custom to add your own)</span>
              <RolePicker
                value={role}
                onChange={setRole}
                extraRoles={roster.map((m) => m.role)}
                allowDeleteCustom
              />
            </div>
          </>
        )}

        <label className="field">
          <span>Email Address</span>
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.la"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>{mode === 'register' ? 'Create Password (min 4 chars)' : 'Password'}</span>
          <input
            className="input"
            type="password"
            required
            minLength={4}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {mode === 'register' && (
          <label className="field">
            <span>Department / Title (optional)</span>
            <input
              className="input"
              placeholder={`e.g. ${roleLabel(role)} Department`}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
        )}

        {err && <div className="alert alert-danger">{err}</div>}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
          {submitting
            ? 'Please wait...'
            : mode === 'register'
              ? 'Create Account & Continue'
              : 'Sign In to SignFlow'}
        </button>
      </form>
    </>
  );

  return (
    <AuthCtx.Provider value={{ user, roster, loading, openAuthModal, logout, refreshAuth, saveSignature }}>
      {loading ? (
        <div className="auth-gate-shell">
          <div className="auth-gate-loader">
            <span className="brand-mark auth-gate-mark" aria-hidden>
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 17c3-4 5-9 7-9s-1 9 2 9 3-5 5-5 2 3 4 3" />
              </svg>
            </span>
            <div style={{ fontWeight: 650, fontSize: '1.05rem' }}>SignFlow</div>
            <div className="small muted">Checking your session…</div>
          </div>
        </div>
      ) : !user ? (
        <div className="auth-gate-shell">
          <div className="auth-gate-card stack" role="main" aria-label="Sign in or create account">
            <div className="auth-gate-brand">
              <span className="brand-mark auth-gate-mark" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 17c3-4 5-9 7-9s-1 9 2 9 3-5 5-5 2 3 4 3" />
                </svg>
              </span>
              <h1>SignFlow</h1>
              <p className="muted small">
                {inviteToken
                  ? 'You were invited to the organization! Set your password below to activate your account.'
                  : mode === 'register'
                    ? 'Create your account to scan, sign, and verify organization documents.'
                    : 'Sign in with your organization account to continue.'}
              </p>
            </div>

            {inviteToken && (
              <div className="alert alert-ok small">
                Invite verified for <strong>{email}</strong> ({roleLabel(role)}). Choose a password to activate.
              </div>
            )}

            {authFormContent}

            <div className="auth-gate-foot muted small">
              Protected Workspace · SHA-256 Document Ledger
            </div>
          </div>
        </div>
      ) : (
        <>
          {children}

          {modalOpen && (
            <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
              <div
                className="modal stack"
                style={{ maxWidth: 460 }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Sign in or create account"
              >
                <div className="row-between">
                  <div>
                    <h2>{mode === 'register' ? 'First-Time Account Setup' : 'Sign In with Email'}</h2>
                    <p className="muted small">
                      {inviteToken
                        ? 'You were invited to the organization! Set your password below to activate your account.'
                        : mode === 'register'
                          ? 'Create your organization account with your email & role.'
                          : 'Sign in with your email to prepare, trace, chat, and sign team papers.'}
                    </p>
                  </div>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModalOpen(false)}>
                    ✕
                  </button>
                </div>

                {authFormContent}
              </div>
            </div>
          )}
        </>
      )}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
