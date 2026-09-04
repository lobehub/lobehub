import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;
const isHonoDevTopology =
  process.env.NODE_ENV !== 'production' && process.env.LOBE_DEV_TOPOLOGY === 'hono';
const honoDevTarget = `http://localhost:${process.env.HONO_PORT || 3011}`;

const vercelConfig = {
  // Vercel serverless optimization: exclude musl binaries from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // This saves ~16MB (sharp-musl) per serverless function
  outputFileTracingExcludes: {
    '*': [
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
  rewrites: isHonoDevTopology
    ? async () => ({
        beforeFiles: [
          {
            destination: `${honoDevTarget}/trpc/:path*`,
            source: '/trpc/:path*',
          },
        ],
      })
    : undefined,
});

export default nextConfig;
