import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const isBrowserTest = process.env.PLAYWRIGHT_TEST === '1';
const internalHost = process.env.TAURI_DEV_HOST || 'localhost';

console.log('>>> next.config.js cargado <<<');
/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  reactStrictMode: false,
  output: 'export',
  distDir: isBrowserTest ? '.next-e2e' : 'dist',
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: isProd || isBrowserTest ? undefined : `http://${internalHost}:3000`,
};

export default nextConfig;
