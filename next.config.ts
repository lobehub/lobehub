import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;
const TURBOPACK_VERCEL_MEMORY_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

const vercelConfig = {
  experimental: {
    // Turbopack memory is configured in bytes, not MB.
    // Keep enough headroom for Node, loaders, and the rest of the build container.
    turbopackMemoryLimit: TURBOPACK_VERCEL_MEMORY_LIMIT_BYTES,
  },
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
});

export default nextConfig;
