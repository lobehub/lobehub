import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries and ffmpeg from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // ffmpeg-static (~76MB) is only needed by /api/webhooks/video/* route
  // This saves ~120MB (29MB canvas-musl + 16MB sharp-musl + 76MB ffmpeg)
  outputFileTracingExcludes: {
    '*': [
      'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
      'node_modules/.pnpm/@img+sharp-libvips-*musl*',
      'node_modules/ffmpeg-static/**',
      'node_modules/.pnpm/ffmpeg-static*/**',
      // Exclude SPA/desktop/mobile build artifacts from serverless functions
      'public/spa/**',
      'dist/desktop/**',
      'dist/mobile/**',
      'apps/desktop/**',
      'packages/database/migrations/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/webhooks/video/*': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
};
const nextConfig = defineConfig({
  ...(isVercel ? vercelConfig : {}),
});

export default nextConfig;
