import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker';
import './globals.css';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: 'FamLink',
  title: {
    default: 'FamLink — Know your family is safe',
    template: '%s · FamLink',
  },
  description:
    'A private space for your family. Share your location on your terms, see everyone on one map, and stay in touch.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'FamLink',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  // FamLink is private by definition; keep every page out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#161412' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-card focus:text-fg focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lift"
        >
          Skip to content
        </a>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
