import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { ToastProvider } from '@/components/Toast';
import { isSupabaseConfigured, mailTransport } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SignFlow — Scan, Sign & Verify',
  description: 'Turn paper into clean PDFs, collect OTP-verified co-signatures and verify sealed documents.',
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
          <Nav backend={backend} mail={mail} />
          <main className="container">{children}</main>
          <footer className="site-footer">
            <span>SignFlow · SHA-256 Cryptographic Ledger · OTP-Verified Co-Signing</span>
            <span>100% Original Color Scanner · iOS Minimalist Edition</span>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
