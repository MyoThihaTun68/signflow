/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep dev and build artifacts separate so running `npm run build` never breaks a running `npm run dev`
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [
    'nodemailer',
    '@signpdf/signpdf',
    '@signpdf/signer-p12',
    '@signpdf/placeholder-pdf-lib',
    '@signpdf/utils',
    'node-forge',
  ],
  webpack: (config) => {
    // pdf.js is loaded from /public at runtime; never bundle the optional node canvas.
    config.resolve.alias = { ...(config.resolve.alias || {}), canvas: false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
