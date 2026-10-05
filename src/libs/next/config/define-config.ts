import { codeInspectorPlugin } from 'code-inspector-plugin';
import { type NextConfig } from 'next';
import { type Header, type Redirect } from 'next/dist/lib/load-custom-routes';

const LANDING_SITEMAP_URL = 'https://lobehub.com/sitemap.xml';

interface CustomNextConfig {
  experimental?: NextConfig['experimental'];
  headers?: Header[];
  outputFileTracingExcludes?: NextConfig['outputFileTracingExcludes'];
  outputFileTracingIncludes?: NextConfig['outputFileTracingIncludes'];
  redirects?: Redirect[];
  serverExternalPackages?: NextConfig['serverExternalPackages'];
  turbopack?: NextConfig['turbopack'];
}

export function defineConfig(config: CustomNextConfig) {
  const isProd = process.env.NODE_ENV === 'production';
  const buildWithDocker = process.env.DOCKER === 'true';

  const shouldUseCSP = process.env.ENABLED_CSP === '1';

  const isTest =
    process.env.NODE_ENV === 'test' || process.env.TEST === '1' || process.env.E2E === '1';

  const isStandaloneMode = buildWithDocker || process.env.NEXT_BUILD_STANDALONE === '1';

  const standaloneConfig: NextConfig = {
    output: 'standalone',

    outputFileTracingIncludes: {
      '*': [
        'public/**/*',
        '.next/static/**/*',

        // Only needed for Docker standalone builds.
        // On Vercel (serverless), including native bindings can easily exceed function size limits.
        ...(buildWithDocker
          ? [
              // Exclude SPA/desktop/mobile build artifacts from serverless functions
              'public/_spa/**',
              'dist/desktop/**',
              'dist/mobile/**',

              'packages/database/migrations/**',
            ]
          : []),
      ],
    },
  };

  const assetPrefix = (process.env.ASSET_BASE_URL || process.env.NEXT_PUBLIC_ASSET_PREFIX)?.replace(
    /\/+$/,
    '',
  );

  const nextConfig: NextConfig = {
    ...(isStandaloneMode ? standaloneConfig : {}),
    // Stop `next dev` from auto-injecting the nextjs-agent-rules block into AGENTS.md.
    agentRules: false,
    assetPrefix,
    // Gated, not unconditional: an asset host that omits Access-Control-Allow-Origin
    // turns every tag into one the browser refuses to execute. Same-origin needs no opt-in.
    crossOrigin: assetPrefix ? 'anonymous' : undefined,

    compiler: {
      emotion: true,
    },
    compress: isProd,
    experimental: {
      optimizePackageImports: [
        'emoji-mart',
        '@emoji-mart/react',
        '@emoji-mart/data',
        '@icons-pack/react-simple-icons',
        '@lobehub/ui',
        '@lobehub/icons',
      ],
      // oidc provider depend on constructor.name
      // but swc minification will remove the name
      // so we need to disable it
      // refs: https://github.com/lobehub/lobe-chat/pull/7430
      serverMinification: false,
      webVitalsAttribution: ['CLS', 'LCP'],
      ...config.experimental,
    },
    async headers() {
      const securityHeaders = [
        {
          key: 'x-robots-tag',
          value: 'all',
        },
      ];

      if (shouldUseCSP) {
        securityHeaders.push(
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none';",
          },
        );
      }

      return [
        {
          headers: securityHeaders,
          source: '/:path*',
        },
        // Agent Share visitor pages live under `/agent/:slugOrId` and are
        // reachable by anyone holding the link. Keep them out of search
        // indexes (privacy) — the SPA shell is static per variant, so a
        // per-route `<meta name="robots">` is not an option; the header is.
        // Listed after the global rule so it overrides `x-robots-tag: all`.
        {
          headers: [{ key: 'x-robots-tag', value: 'noindex, nofollow' }],
          source: '/agent/:path*',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/app-icons/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/app-images/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/videos/(.*).(mp4|webm|ogg|avi|mov|wmv|flv|mkv)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/screenshots/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'Vercel-CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/og/(.*).(png|jpe?g|gif|svg|ico|webp)',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/favicon-32x32.ico',
        },
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
            {
              key: 'CDN-Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/apple-touch-icon.png',
        },
        // Passkey configuration files for iOS and Android
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/apple-app-site-association',
        },
        {
          headers: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600',
            },
          ],
          source: '/.well-known/assetlinks.json',
        },
        ...(config.headers ?? []),
      ];
    },
    logging: {
      fetches: {
        fullUrl: true,
        hmrRefreshes: true,
      },
    },
    ...(config.outputFileTracingExcludes && {
      outputFileTracingExcludes: config.outputFileTracingExcludes,
    }),
    ...(config.outputFileTracingIncludes && {
      outputFileTracingIncludes: config.outputFileTracingIncludes,
    }),
    reactStrictMode: true,
    redirects: async () => [
      // Sitemap generation lives on the landing site; keep legacy app sitemap URLs crawlable.
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap-0.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap-index.xml',
      },
      {
        destination: LANDING_SITEMAP_URL,
        permanent: true,
        source: '/sitemap/:path*',
      },
      {
        destination: '/manifest.webmanifest',
        permanent: true,
        source: '/manifest.json',
      },
      {
        destination: '/community/agent',
        permanent: true,
        source: '/community/assistants',
      },
      {
        destination: '/community/plugin',
        permanent: true,
        source: '/community/plugins',
      },
      {
        destination: '/community/model',
        permanent: true,
        source: '/community/models',
      },
      {
        destination: '/community/provider',
        permanent: true,
        source: '/community/providers',
      },
      // Legacy redirects from /discover to /community
      {
        destination: '/community',
        permanent: true,
        source: '/discover',
      },
      {
        destination: '/community/:path*',
        permanent: true,
        source: '/discover/:path*',
      },
      // {
      //   destination: '/settings/common',
      //   permanent: true,
      //   source: '/settings',
      // },
      // we need back /repos url in the further
      {
        destination: '/files',
        permanent: false,
        source: '/repos',
      },
      {
        destination: '/',
        permanent: true,
        source: '/chat',
      },
      // Redirect old Clerk login route to Better Auth signin
      {
        destination: '/signin',
        permanent: true,
        source: '/login',
      },
      ...(config.redirects ?? []),
    ],
    // when external packages in dev mode with turbopack, this config will lead to bundle error
    serverExternalPackages: config.serverExternalPackages ?? [
      'pdfkit',
      '@lobehub/editor',
      'discord.js',
      'ffmpeg-static',
      'pdfjs-dist',
      'ajv',
      'oidc-provider',
    ],

    transpilePackages: ['mermaid'],
    turbopack: {
      rules: {
        ...(isTest
          ? void 0
          : // Narrow the plugin's `**/*.{jsx,tsx,js,ts,mjs,mts}` rule to JSX
            // files only. The broad glob also matches Turbopack-internal
            // virtual assets like `[turbopack-ecmascript]/worker/browser/createWorker.ts`
            // (injected for `new Worker(new URL(...))`), which the webpack
            // loader shim then tries to read from disk — any page whose module
            // graph pulls in a web worker dies with "Reading source code for
            // parsing failed". The inspector only instruments JSX elements, so
            // jsx/tsx keeps click-to-source fully functional.
            Object.fromEntries(
              Object.entries(
                codeInspectorPlugin({
                  bundler: 'turbopack',
                  hotKeys: ['altKey', 'ctrlKey'],
                }) as Record<string, unknown>,
              ).map(([glob, rule]) => [glob.replace('{jsx,tsx,js,ts,mjs,mts}', '{jsx,tsx}'), rule]),
            )),
        '*.md': {
          as: '*.js',
          loaders: ['raw-loader'],
        },
      },
      ...config.turbopack,
    },

    typescript: {
      ignoreBuildErrors: true,
    },
  };

  return nextConfig;
}
