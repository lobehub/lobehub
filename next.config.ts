import { prepareServerI18n, watchServerI18n } from './scripts/serverI18n/prepare';
import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;

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
  outputFileTracingExcludes: {
    '*': [
      // Server translations are projected at build time. Broad filesystem traces
      // must not reintroduce the source dictionaries as runtime assets.
      'locales/**',
      'src/libs/i18n/server/generated/report.json',
      ...(isVercel ? vercelConfig.outputFileTracingExcludes['*'] : []),
    ],
  },
});

let stopI18nWatcher: (() => void) | undefined;

export default async (phase: string) => {
  if (phase === 'phase-production-build' || phase === 'phase-development-server') {
    await prepareServerI18n(process.cwd());
    if (phase === 'phase-development-server') {
      stopI18nWatcher?.();
      stopI18nWatcher = await watchServerI18n(process.cwd());
    }
  }
  return nextConfig;
};
