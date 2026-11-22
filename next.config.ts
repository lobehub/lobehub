import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;

const vercelConfig = {
  // Vercel runs recurring schedules through QStash, never the in-process
  // scheduler. Marking the build lets the bundler drop that scheduler's import
  // from `src/instrumentation.ts`: @vercel/next copies everything instrumentation
  // imports into every function, and the task runtime behind it pushes each one
  // past the 250 MB function size limit.
  compiler: {
    defineServer: { 'process.env.LOBE_SERVERLESS_BUILD': '1' },
  },
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
});

export default nextConfig;
