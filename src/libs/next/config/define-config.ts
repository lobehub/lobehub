import analyzer from '@next/bundle-analyzer';
import withSerwistInit from '@serwist/next';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { type NextConfig } from 'next';
import { type Header, type Redirect } from 'next/dist/lib/load-custom-routes';
import ReactComponentName from 'react-scan/react-component-name/webpack';

interface CustomNextConfig {
  experimental?: NextConfig['experimental'];
  headers?: Header[];
  outputFileTracingExcludes?: NextConfig['outputFileTracingExcludes'];
  redirects?: Redirect[];
  serverExternalPackages?: NextConfig['serverExternalPackages'];
  turbopack?: NextConfig['turbopack'];
  webpack?: NextConfig['webpack'];
}

export function defineConfig(config: CustomNextConfig) {
  const isProd = process.env.NODE_ENV === 'production';
  const buildWithDocker = process.env.DOCKER === 'true';

  const enableReactScan = !!process.env.REACT_SCAN_MONITOR_API_KEY;
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
              // Ensure native bindings are included in standalone output.
              // `@napi-rs/canvas` is loaded via dynamic `require()` (see packages/file-loaders),
              // which may not be picked up by Next.js output tracing.
              'node_modules/@napi-rs/canvas/**/*',
              // pnpm real package locations (including platform-specific bindings with `.node`)
              'node_modules/.pnpm/@napi-rs+canvas*/**/*',
              'node_modules/.pnpm/@napi-rs+canvas-*/**/*',
            ]
          : []),
      ],
    },
  };

  const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  const nextConfig: NextConfig = {
    ...(isStandaloneMode ? standaloneConfig : {}),
    assetPrefix,

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
      webpackBuildWorker: true,
      webpackMemoryOptimizations: true,
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
        {
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
          source: '/icons/(.*).(png|jpe?g|gif|svg|ico|webp)',
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
          source: '/images/(.*).(png|jpe?g|gif|svg|ico|webp)',
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
    reactStrictMode: true,
    redirects: async () => [
      {
        destination: '/sitemap-index.xml',
        permanent: true,
        source: '/sitemap.xml',
      },
      {
        destination: '/sitemap-index.xml',
        permanent: true,
        source: '/sitemap-0.xml',
      },
      {
        destination: '/sitemap/plugins-1.xml',
        permanent: true,
        source: '/sitemap/plugins.xml',
      },
      {
        destination: '/sitemap/assistants-1.xml',
        permanent: true,
        source: '/sitemap/assistants.xml',
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
    // @napi-rs/canvas is a native module that can't be bundled by Turbopack
    // pdfjs-dist uses @napi-rs/canvas for DOMMatrix polyfill in Node.js environment
    serverExternalPackages: config.serverExternalPackages ?? [
      'pdfkit',
      '@napi-rs/canvas',
      'pdfjs-dist',
    ],

    transpilePackages: ['mermaid', 'better-auth-harmony'],
    turbopack: {
      rules: isTest
        ? void 0
        : codeInspectorPlugin({
            bundler: 'turbopack',
            hotKeys: ['altKey', 'ctrlKey'],
          }),
      ...config.turbopack,
    },

    typescript: {
      ignoreBuildErrors: true,
    },

    webpack(baseWebpackConfig, options) {
      baseWebpackConfig.experiments = {
        asyncWebAssembly: true,
        layers: true,
      };

      // 开启该插件会导致 pglite 的 fs bundler 被改表
      if (enableReactScan) {
        baseWebpackConfig.plugins.push(ReactComponentName({}));
      }

      // to fix shikiji compile error
      // refs: https://github.com/antfu/shikiji/issues/23
      baseWebpackConfig.module.rules.push({
        resolve: {
          fullySpecified: false,
        },
        test: /\.m?js$/,
        type: 'javascript/auto',
      });

      baseWebpackConfig.resolve.alias.canvas = false;

      // to ignore epub2 compile error
      // refs: https://github.com/lobehub/lobe-chat/discussions/6769
      baseWebpackConfig.resolve.fallback = {
        ...baseWebpackConfig.resolve.fallback,
        zipfile: false,
      };

      if (
        assetPrefix &&
        (assetPrefix.startsWith('http://') || assetPrefix.startsWith('https://'))
      ) {
        // fix the Worker URL cross-origin issue
        // refs: https://github.com/lobehub/lobe-chat/pull/9624
        baseWebpackConfig.module.rules.push({
          generator: {
            // @see https://webpack.js.org/configuration/module/#rulegeneratorpublicpath
            publicPath: '/_next/',
          },
          test: /worker\.ts$/,
          // @see https://webpack.js.org/guides/asset-modules/
          type: 'asset/resource',
        });
      }

      const updatedConfig = baseWebpackConfig;

      if (config.webpack) {
        return config.webpack(updatedConfig, options);
      }

      return updatedConfig;
    },
  };

  const noWrapper = (config: NextConfig) => config;

  const withBundleAnalyzer = process.env.ANALYZE === 'true' ? analyzer() : noWrapper;

  const withPWA = isProd
    ? withSerwistInit({
        register: false,
        swDest: 'public/sw.js',
        swSrc: 'src/app/sw.ts',
      })
    : noWrapper;

  return withBundleAnalyzer(withPWA(nextConfig as NextConfig));
}
