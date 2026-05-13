import path from 'node:path';

import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;
const isDev = process.env.NODE_ENV !== 'production';
const isLocalHonoTopology = isDev && process.env.LOBE_DEV_TOPOLOGY === 'hono';

if (isDev) {
  process.title = `lobe-next-${process.env.LOBE_DEV_TOPOLOGY || 'next'}`;
}

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
  ...(isLocalHonoTopology && {
    rewrites: async () => ({
      beforeFiles: [
        {
          destination: '/hono-runtime/api/version',
          source: '/api/version',
        },
        {
          destination: '/hono-runtime/api/v1/:path*',
          source: '/api/v1/:path*',
        },
        {
          destination: '/hono-runtime/api/webhooks/:path*',
          source: '/api/webhooks/:path*',
        },
        {
          destination: '/hono-runtime/api/workflows/:path*',
          source: '/api/workflows/:path*',
        },
        {
          destination: '/hono-runtime/api/agent/:path*',
          source: '/api/agent/:path*',
        },
        {
          destination: '/hono-runtime/api/dev/:path*',
          source: '/api/dev/:path*',
        },
        {
          destination: '/hono-runtime/trpc/:path*',
          source: '/trpc/:path*',
        },
        {
          destination: '/hono-runtime/webapi/:path*',
          source: '/webapi/:path*',
        },
        {
          destination: '/hono-runtime/market/:path*',
          source: '/market/:path*',
        },
        {
          destination: '/hono-runtime/f/:path*',
          source: '/f/:path*',
        },
      ],
    }),
    webpack: (webpackConfig) => {
      webpackConfig.module ??= {};
      webpackConfig.module.rules ??= [];
      webpackConfig.module.rules.push({
        test: /\.md$/,
        type: 'javascript/auto',
        use: 'raw-loader',
      });

      webpackConfig.resolve ??= {};
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        './instrumentation.node': path.resolve(__dirname, 'src/instrumentation.dev-noop.ts'),
        './server/services/gateway': path.resolve(__dirname, 'src/instrumentation.dev-noop.ts'),
      };

      return webpackConfig;
    },
  }),
});

export default nextConfig;
