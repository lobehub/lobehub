import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // This saves ~45MB (29MB canvas-musl + 16MB sharp-musl) per serverless function
  outputFileTracingExcludes: {
    '*': [
      'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
      'node_modules/.pnpm/@img+sharp-libvips-*musl*',
      // Exclude SPA/desktop/mobile build artifacts from serverless functions
      'public/_spa/**',
      'dist/desktop/**',
      'dist/mobile/**',
      'apps/desktop/**',
      'packages/database/migrations/**',
    ],
  },
};
const nextConfig = defineConfig({
  ...(isVercel ? vercelConfig : {}),
  rewrites: async () => [
    {
      destination: '/favicon.ico',
      source: '/_spa/favicon.ico',
    },
    {
      destination: '/favicon-32x32.ico',
      source: '/_spa/favicon-32x32.ico',
    },
    {
      destination: '/favicon-dev.ico',
      source: '/_spa/favicon-dev.ico',
    },
    {
      destination: '/favicon-32x32-dev.ico',
      source: '/_spa/favicon-32x32-dev.ico',
    },
  ],
});

export default nextConfig;
