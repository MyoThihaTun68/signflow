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
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const backend = isSupabaseConfigured() ? 'supabase' : 'local';
  const mail = mailTransport();
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <Nav backend={backend} mail={mail} />
          <main className="container">{children}</main>
          <footer className="site-footer">
            <span>SignFlow · SHA-256 Cryptographic Ledger · OTP-Verified Co-Signing</span>
            <span>100% Original Color Scanner · PDF-Lib &amp; PDF.js Engine</span>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
