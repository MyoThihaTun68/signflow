import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Nav } from '@/components/Nav';
import { ToastProvider } from '@/components/Toast';
import { isSupabaseConfigured, mailTransport } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SignFlow — Scan, Sign & Verify',
  description: 'Turn paper into clean PDFs, collect team co-signatures and verify sealed documents.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

const FOUC_SCRIPT = `try{var m=document.querySelector('meta[name="color-scheme"]');if(m){m.content=localStorage.getItem("color-scheme")||"light dark";}var a=localStorage.getItem("sf-accent");if(a){document.documentElement.dataset.accent=a;}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const backend = isSupabaseConfigured() ? 'supabase' : 'local';
  const mail = mailTransport();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>
          <AuthProvider>
            <div className="app-shell">
              <Nav />
              <main className="container">{children}</main>
              <footer className="site-footer">
                <div className="site-footer-inner">
                  <div className="row" style={{ gap: 10 }}>
                    <span
                      className={`badge ${backend === 'supabase' ? 'badge-ok' : 'badge-muted'}`}
                      title={
                        backend === 'supabase'
                          ? 'Connected to Supabase PostgreSQL + Private Storage'
                          : 'Using local .data fallback'
                      }
                    >
                      <span className="badge-dot" />
                      {backend === 'supabase' ? 'Supabase Connected' : 'Local Storage'}
                    </span>
                    {mail !== 'console' && (
                      <span className="badge badge-primary">Mail: {mail.toUpperCase()}</span>
                    )}
                    <span>SignFlow · SHA-256 Cryptographic Ledger</span>
                  </div>
                  <span>100% Original Color Scanner · Pure Ink Stamp</span>
                </div>
              </footer>
            </div>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
