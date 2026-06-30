import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import type { ModulePreloadOptions, UserConfig } from 'vite';

import { viteEmotionSpeedy } from './emotionSpeedy';
import { viteMarkdownImport } from './markdownImport';
import { viteNodeModuleStub } from './nodeModuleStub';
import { vitePlatformResolve } from './platformResolve';
import { routeChunkPreload } from './routeChunkPreload';

/**
 * Shared manual chunk naming — groups leaf-node modules to reduce chunk file count.
 * Only targets pure data modules (no downstream dependents) to avoid facade chunk issues.
 */
/** Large i18n namespaces that get their own per-locale chunk instead of merging into the locale bundle */
const HEAVY_NS = new Set(['models', 'modelProvider']);

/**
 * Namespaces loaded by the auth SPA (see createAuthI18n). They get their own
 * per-locale chunk so the auth page never pulls the merged locale bundle of the
 * main app, and both SPAs share the same chunk URLs for these namespaces.
 */
const AUTH_NS = new Set(['auth', 'authError', 'common', 'error', 'marketAuth', 'oauth']);

const resolveModuleDirname = () => {
  if (typeof __dirname === 'string') return __dirname;
  if (import.meta.url.startsWith('file:')) return path.dirname(fileURLToPath(import.meta.url));

  return path.dirname(import.meta.url);
};

const LOBEHUB_ROOT = path.resolve(resolveModuleDirname(), '../..');
const LOBEHUB_EDITOR_PACKAGE = path.join(LOBEHUB_ROOT, 'node_modules/@lobehub/editor');
const resolveLobehubEditorEntry = (entry: string) => path.join(LOBEHUB_EDITOR_PACKAGE, 'es', entry);

export const sharedRendererResolve = {
  alias: [
    { find: /^@lobehub\/editor$/, replacement: resolveLobehubEditorEntry('index.js') },
    {
      find: /^@lobehub\/editor\/codemirror$/,
      replacement: resolveLobehubEditorEntry('codemirror.js'),
    },
    {
      find: /^@lobehub\/editor\/headless$/,
      replacement: resolveLobehubEditorEntry('headless.js'),
    },
    {
      find: /^@lobehub\/editor\/litexml-commands$/,
      replacement: path.join(LOBEHUB_EDITOR_PACKAGE, 'es/plugins/litexml/command/symbols.js'),
    },
    { find: /^@lobehub\/editor\/react$/, replacement: resolveLobehubEditorEntry('react.js') },
    {
      find: /^@lobehub\/editor\/renderer$/,
      replacement: resolveLobehubEditorEntry('renderer.js'),
    },
  ],
  // Workspace builtin tools may have a peer symlink to another @lobehub/editor
  // patch version. Example: ReactListPlugin from 4.18.0 cannot read the 4.18.1
  // Editor context and crashes with "cannot find a LexicalComposerContext".
  dedupe: ['@lobehub/editor', 'react', 'react-dom'],
} satisfies NonNullable<UserConfig['resolve']>;

/** antd locale filename → app locale */
const ANTD_LOCALE: Record<string, string> = {
  ar_EG: 'ar',
  bg_BG: 'bg-BG',
  de_DE: 'de-DE',
  en_US: 'en-US',
  es_ES: 'es-ES',
  fa_IR: 'fa-IR',
  fr_FR: 'fr-FR',
  it_IT: 'it-IT',
  ja_JP: 'ja-JP',
  ko_KR: 'ko-KR',
  nl_NL: 'nl-NL',
  pl_PL: 'pl-PL',
  pt_BR: 'pt-BR',
  ru_RU: 'ru-RU',
  tr_TR: 'tr-TR',
  vi_VN: 'vi-VN',
  zh_CN: 'zh-CN',
  zh_TW: 'zh-TW',
};

/** dayjs locale filename → app locale */
const DAYJS_LOCALE: Record<string, string> = {
  'ar': 'ar',
  'bg': 'bg-BG',
  'de': 'de-DE',
  'en': 'en-US',
  'es': 'es-ES',
  'fa': 'fa-IR',
  'fr': 'fr-FR',
  'it': 'it-IT',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'nl': 'nl-NL',
  'pl': 'pl-PL',
  'pt-br': 'pt-BR',
  'ru': 'ru-RU',
  'tr': 'tr-TR',
  'vi': 'vi-VN',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
};

const isNodePackage = (id: string, packageName: string) => {
  const normalized = id.replaceAll('\\', '/');

  return normalized.includes(`/node_modules/${packageName}/`);
};

function sharedManualChunks(id: string): string | undefined {
  // default locale sources live in packages/locales/src/default — their chunk
  // has historically been named i18n-src by the generic locale match below
  const defaultLocaleMatch = id.match(/\/locales\/src\/default\/([^/.]+)/);
  if (defaultLocaleMatch) {
    const ns = defaultLocaleMatch[1];
    if (AUTH_NS.has(ns)) return `i18n-default-${ns}`;
    return 'i18n-src';
  }

  // runtime helpers (resources/create/utils) in packages/locales/src must not
  // share a chunk with the default locale data, or every consumer would
  // statically pull the whole default bundle
  if (id.includes('/locales/src/')) return;

  // i18n locale JSON/TS files
  const localeMatch = id.match(/\/locales\/([^/]+)\/([^/.]+)/);
  if (localeMatch) {
    const [, locale, ns] = localeMatch;
    if (AUTH_NS.has(ns)) return `i18n-${locale}-${ns}`;
    if (locale === 'default') return 'i18n-default';
    if (HEAVY_NS.has(ns)) return `i18n-${locale}-${ns}`;
    return `i18n-${locale}`;
  }

  if (id.includes('/packages/model-runtime/') || isNodePackage(id, 'openai'))
    return 'vendor-ai-runtime';

  // shared constants would otherwise be captured into vendor-ai-runtime,
  // dragging the whole AI chunk into the auth SPA's static graph
  if (id.includes('/packages/const/src/')) return 'app-const';

  // model-bank (monorepo package — split before node_modules guard)
  if (id.includes('model-bank')) return 'providerConfig';

  if (!id.includes('node_modules')) return;

  // antd locale → merge into i18n-{locale}
  const antdMatch = id.match(/antd\/es\/locale\/([^/.]+)\.js/);
  if (antdMatch) {
    const locale = ANTD_LOCALE[antdMatch[1]];
    if (locale) return `i18n-${locale}`;
  }

  // dayjs locale → merge into i18n-{locale}
  const dayjsMatch = id.match(/dayjs\/locale\/([^/.]+)\.js/);
  if (dayjsMatch) {
    const locale = DAYJS_LOCALE[dayjsMatch[1]];
    if (locale) return `i18n-${locale}`;
  }

  if (
    isNodePackage(id, 'react') ||
    isNodePackage(id, 'react-dom') ||
    isNodePackage(id, 'react-router') ||
    isNodePackage(id, 'scheduler')
  ) {
    return 'vendor-react';
  }

  if (
    id.includes('es-toolkit') ||
    id.includes('@emotion/') ||
    id.includes('/motion/') ||
    id.includes('framer-motion')
  ) {
    return 'vendor-ui-runtime';
  }

  if (
    isNodePackage(id, 'dayjs') ||
    isNodePackage(id, 'i18next') ||
    isNodePackage(id, 'react-i18next') ||
    isNodePackage(id, 'swr') ||
    isNodePackage(id, 'zustand')
  ) {
    return 'vendor-data-runtime';
  }

  // Lucide icons
  if (id.includes('lucide-react')) return 'vendor-icons';
}

const sharedChunkFileNames = (chunkInfo: { name: string }) => {
  const { name } = chunkInfo;
  if (name.startsWith('i18n-')) return 'i18n/[name]-[hash].js';
  if (name.startsWith('vendor-')) return 'vendor/[name]-[hash].js';
  return 'assets/[name]-[hash].js';
};

const isI18nChunkFileName = (fileName: string) => {
  const normalized = fileName.split('?')[0].replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1) ?? normalized;

  return normalized.startsWith('i18n/') || basename.startsWith('i18n-');
};

export const sharedModulePreload = {
  resolveDependencies: (_filename, deps) => deps.filter((dep) => !isI18nChunkFileName(dep)),
} satisfies ModulePreloadOptions;

export const sharedRollupOutput = {
  chunkFileNames: sharedChunkFileNames,
  manualChunks: sharedManualChunks,
};

interface SharedRolldownOutputOptions {
  strictExecutionOrder?: boolean;
}

export const createSharedRolldownOutput = (options: SharedRolldownOutputOptions = {}) => ({
  chunkFileNames: sharedChunkFileNames,
  strictExecutionOrder: options.strictExecutionOrder ?? true,
  codeSplitting: {
    groups: [
      {
        name: (moduleId: string) => sharedManualChunks(moduleId) ?? null,
      },
    ],
  },
});

type Platform = 'web' | 'mobile' | 'desktop' | 'auth';

const isDev = process.env.NODE_ENV !== 'production';
const enableRouteChunkPreload = process.env.LOBE_ROUTE_CHUNK_PRELOAD !== 'false';

interface SharedRendererOptions {
  platform: Platform;
  tsconfigPaths?: boolean;
}

export function sharedRendererPlugins(options: SharedRendererOptions) {
  return [
    viteEmotionSpeedy(),
    viteMarkdownImport(),
    viteNodeModuleStub(),
    vitePlatformResolve(options.platform),
    enableRouteChunkPreload && routeChunkPreload(),

    isDev && {
      name: 'lobe-dev-strip-manifest',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: (html: string) => html.replace(/\s*<link\s+rel="manifest"[^>]*>\s*/i, '\n    '),
      },
    },

    isDev &&
      codeInspectorPlugin({
        bundler: 'vite',
        exclude: [/\.(css|json|html)$/],
        hotKeys: ['altKey', 'ctrlKey'],
      }),
    react(),
  ];
}

export function sharedRendererDefine(options: { isElectron: boolean; isMobile: boolean }) {
  const nextPublicDefine = Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => key.toUpperCase().startsWith('NEXT_PUBLIC_'))
      .map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  );

  return {
    '__CI__': process.env.CI === 'true' ? 'true' : 'false',
    '__DEV__': process.env.NODE_ENV !== 'production' ? 'true' : 'false',
    '__ELECTRON__': JSON.stringify(options.isElectron),
    '__MOBILE__': JSON.stringify(options.isMobile),
    '__TEST__': 'false',
    ...nextPublicDefine,
    // Keep a safe fallback so generic `process.env` access won't crash in browser runtime.
    'process.env': '{}',
  };
}

export const sharedOptimizeDeps = {
  include: [
    'react',
    'react-dom',
    'react-dom/client',
    'react-router',
    'react-router/dom',
    'antd',
    '@ant-design/icons',
    '@lobehub/ui',
    '@lobehub/ui > @emotion/react',
    'antd-style',
    'zustand',
    'zustand/middleware',
    'swr',
    'i18next',
    'react-i18next',
    'dayjs',
    'dayjs/locale/ar',
    'dayjs/locale/bg',
    'dayjs/locale/de',
    'dayjs/locale/en',
    'dayjs/locale/es',
    'dayjs/locale/fa',
    'dayjs/locale/fr',
    'dayjs/locale/it',
    'dayjs/locale/ja',
    'dayjs/locale/ko',
    'dayjs/locale/nl',
    'dayjs/locale/pl',
    'dayjs/locale/pt-br',
    'dayjs/locale/ru',
    'dayjs/locale/tr',
    'dayjs/locale/vi',
    'dayjs/locale/zh-cn',
    'dayjs/locale/zh-tw',

    'ahooks',
    'motion/react',
  ],
};

export const __testing = {
  sharedManualChunks,
};
