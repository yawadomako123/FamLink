import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // FamLink handles location data. Never let it be embedded or sniffed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            /*
             * Geolocation, camera and microphone are all required by the
             * product — location sharing and voice/video calls respectively —
             * and are granted to this origin only. Everything else is denied.
             *
             * Denying camera and microphone here was correct before calls
             * existed and silently broke them afterwards: getUserMedia is
             * rejected by policy before the browser ever prompts, so no
             * permission dialog appears and the failure looks like a hardware
             * problem.
             */
            value:
              'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()',
          },
        ],
      },
      {
        // The service worker must never be cached, or clients get stuck on an old shell.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Location and family data must never be cached by a shared proxy.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, private' }],
      },
    ];
  },
};

export default nextConfig;
