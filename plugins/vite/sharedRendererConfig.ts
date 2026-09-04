import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import type { ModulePreloadOptions } from 'vite';

import { viteEmotionSpeedy } from './emotionSpeedy';
import { lobeIconImports } from './lobeIconImports';
import { lobeUiImports } from './lobeUiImports';
import { viteMarkdownImport } from './markdownImport';
import { viteNodeModuleStub } from './nodeModuleStub';
import { vitePlatformResolve } from './platformResolve';
import { viteStaticStylesPrecompile } from './staticStylesPrecompile';

/**
 * Shared manual chunk naming — groups leaf-node modules to reduce chunk file count.
 * Only targets pure data modules (no downstream dependents) to avoid facade chunk issues.
 */
/** Large i18n namespaces that stay on demand instead of merging into the locale bundle. */
const HEAVY_NS = new Set(['models', 'modelProvider']);

/** Namespaces shared with the independently built auth SPA. */
const AUTH_NS = new Set(['auth', 'authError', 'common', 'error', 'marketAuth', 'oauth']);

/** Namespaces synchronously bundled by the main SPA shell. */
const APP_SHELL_NS = new Set(['chat', 'home']);

/** Default-language metadata imported directly by an eager route component. */
const EAGER_DEFAULT_NS = new Set(['hotkey']);

const MODEL_RUNTIME_CLIENT_MODULES = [
  '/core/usageConverters/utils/resolveImageSinglePrice.ts',
  '/core/usageConverters/utils/resolveVideoSinglePrice.ts',
  '/helpers/parseToolCalls.ts',
  '/providers/openai/modelId.ts',
  '/types/error.ts',
  '/types/toolsCalling.ts',
  '/utils/createError.ts',
  '/utils/modelExtendParams.ts',
  '/utils/uriParser.ts',
];

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

const DEVTOOLS_SOURCE_SEGMENTS = [
  '/src/business/client/registerDevDockItems.ts',
  '/src/features/AgentMockDevtools/',
  '/src/features/Conversation/ChatList/components/AutoScroll/DebugInspector.tsx',
  '/src/features/DevDock/',
  '/src/features/DevFeatureFlagPanel/',
  '/src/features/DevPanel/',
  '/src/features/DevWorkspaceRole/',
  '/src/services/electron/devtools.ts',
];

const isDeferredDevtoolsSource = (id: string) => {
  const normalized = id.replaceAll('\\', '/');

  return DEVTOOLS_SOURCE_SEGMENTS.some((segment) => normalized.includes(segment));
};

function sharedManualChunks(id: string): string | undefined {
  // Only dedicated DevDock packages are manually grouped. Grouping DevDock
  // source modules themselves would absorb their large shared dependency
  // closure; their existing dynamic-import boundaries must remain intact.
  if (isNodePackage(id, 'react-scan')) return 'devtools-react-scan';

  // Default locale sources live in packages/locales/src/default. Keep shell
  // and heavy namespaces isolated; the remaining on-demand namespaces share a
  // coarse fallback chunk to avoid creating hundreds of tiny files.
  const defaultLocaleMatch = id.match(/\/locales\/src\/default\/([^/.]+)/);
  if (defaultLocaleMatch) {
    const ns = defaultLocaleMatch[1];
    if (APP_SHELL_NS.has(ns)) return 'i18n-default-app-shell';
    if (AUTH_NS.has(ns) || EAGER_DEFAULT_NS.has(ns) || HEAVY_NS.has(ns))
      return `i18n-default-${ns}`;
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
    if (APP_SHELL_NS.has(ns)) return `i18n-${locale}-app-shell`;
    if (AUTH_NS.has(ns) || HEAVY_NS.has(ns)) return `i18n-${locale}-${ns}`;
    if (locale === 'default') return 'i18n-default';
    return `i18n-${locale}`;
  }

  // These small contracts are used by the eager app shell and the deferred
  // composer. Without an explicit boundary, Rolldown captures them inside the
  // large ChatInput chunk and turns that otherwise-lazy chunk into an eager
  // dependency of the home layout.
  if (
    id.includes('/src/business/client/hooks/useBusinessAgentMode.ts') ||
    id.includes('/src/features/ChatInput/utils/contextSelections.ts') ||
    id.includes('/src/routes/(main)/_layout/DesktopLayoutContainer/LayoutContainerContext.ts')
  ) {
    return 'chat-input-contracts';
  }

  if (isNodePackage(id, 'openai')) return 'vendor-ai-runtime';

  // shared constants would otherwise be captured into vendor-ai-runtime,
  // dragging the whole AI chunk into the auth SPA's static graph
  if (id.includes('/packages/const/src/')) return 'app-const';

  if (
    id.includes('/packages/model-runtime/src/') &&
    (id.includes('/packages/model-runtime/src/errors/') ||
      MODEL_RUNTIME_CLIENT_MODULES.some((moduleId) => id.endsWith(moduleId)))
  ) {
    return 'model-runtime-client';
  }

  if (!id.includes('node_modules')) return;

  // UI/date locale modules are loaded during shell initialization. They must
  // not share the coarse i18n-{locale} data chunk, or loading antd/dayjs pulls
  // every deferred namespace for that locale into the bootstrap graph.
  const antdMatch = id.match(/antd\/es\/locale\/([^/.]+)\.js/);
  if (antdMatch) {
    const locale = ANTD_LOCALE[antdMatch[1]];
    if (locale) return `i18n-${locale}-ui-runtime`;
  }

  const dayjsMatch = id.match(/dayjs\/locale\/([^/.]+)\.js/);
  if (dayjsMatch) {
    const locale = DAYJS_LOCALE[dayjsMatch[1]];
    if (locale) return `i18n-${locale}-ui-runtime`;
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

interface SharedChunkInfo {
  moduleIds?: string[];
  name: string;
}

const isOnDemandShikiModule = (moduleId: string) => {
  const normalized = moduleId.replaceAll('\\', '/');

  return (
    normalized.includes('/node_modules/@shikijs/langs/') ||
    normalized.includes('/node_modules/@shikijs/themes/') ||
    normalized.includes('/node_modules/@shikijs/engine-oniguruma/dist/wasm') ||
    normalized.includes('/node_modules/shiki/dist/wasm.mjs')
  );
};

const isModelBankModule = (moduleId: string) =>
  moduleId.replaceAll('\\', '/').includes('/packages/model-bank/src/');

const isOnDemandModelBankCatalog = (moduleIds: string[]) =>
  moduleIds.length > 0 &&
  moduleIds.every(isModelBankModule) &&
  moduleIds.some((moduleId) =>
    moduleId.replaceAll('\\', '/').endsWith('/packages/model-bank/src/aiModels/index.ts'),
  );

const sharedChunkFileNames = (chunkInfo: SharedChunkInfo) => {
  const { moduleIds = [], name } = chunkInfo;
  if (name.startsWith('devtools-') || moduleIds.some(isDeferredDevtoolsSource))
    return 'devtools/[name]-[hash].js';
  if (name.startsWith('i18n-')) return 'i18n/[name]-[hash].js';
  if (name.startsWith('vendor-')) return 'vendor/[name]-[hash].js';
  if (chunkInfo.moduleIds && isOnDemandModelBankCatalog(chunkInfo.moduleIds))
    return 'model-bank/[name]-[hash].js';
  if (chunkInfo.moduleIds?.length && chunkInfo.moduleIds.every(isOnDemandShikiModule))
    return 'shiki/[name]-[hash].js';
  return 'assets/[name]-[hash].js';
};

const isI18nChunkFileName = (fileName: string) => {
  const normalized = fileName.split('?')[0].replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1) ?? normalized;

  return normalized.startsWith('i18n/') || basename.startsWith('i18n-');
};

const isDevtoolsChunkFileName = (fileName: string) => {
  const normalized = fileName.split('?')[0].replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1) ?? normalized;

  return (
    normalized.includes('/devtools/') ||
    normalized.startsWith('devtools/') ||
    basename.startsWith('devtools-')
  );
};

/** Deferred assets must remain demand-loaded rather than entering the service-worker precache. */
export const sharedPwaGlobIgnores = [
  'devtools/**',
  'i18n/**/*.js',
  'model-bank/**/*.js',
  'shiki/**/*.js',
];

/** Runtime caching for deferred assets excluded from the service-worker precache. */
export const sharedPwaRuntimeCaching = [
  {
    handler: 'CacheFirst',
    options: {
      cacheName: 'on-demand-i18n',
      expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 50 },
    },
    urlPattern: ({ url }: { url: URL }) => /\/i18n\/.*\.js$/i.test(url.pathname),
  },
  {
    handler: 'CacheFirst',
    options: {
      cacheName: 'on-demand-shiki',
      expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 150 },
    },
    urlPattern: ({ url }: { url: URL }) => /\/shiki\/.*\.js$/i.test(url.pathname),
  },
  {
    handler: 'CacheFirst',
    options: {
      cacheName: 'on-demand-model-bank',
      expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 5 },
    },
    urlPattern: ({ url }: { url: URL }) => /\/model-bank\/.*\.js$/i.test(url.pathname),
  },
] as const;

export const sharedModulePreload = {
  resolveDependencies: (_filename, deps) =>
    deps.filter((dep) => !isI18nChunkFileName(dep) && !isDevtoolsChunkFileName(dep)),
} satisfies ModulePreloadOptions;

export const sharedRollupOutput = {
  chunkFileNames: sharedChunkFileNames,
  manualChunks: sharedManualChunks,
};

interface SharedRolldownOutputOptions {
  strictExecutionOrder?: boolean;
}

// @lobehub/ui members on the first-screen path of dist/desktop, measured with
// bundle-size-gate --type entry-graph. lobeUiImports splits the barrel into one
// module per member; folding the eager ones back into one chunk keeps the heavy
// members (Markdown, Mermaid, EmojiPicker, Highlighter, Image) on lazy routes.
const UI_CORE_MEMBER_RE =
  /^(?:Accordion|ActionIcon|Block|Collapse|ConfigProvider|Flex|FluentEmoji|Grid|Hotkey|Icon|Img|Modal|MotionProvider|Skeleton|Text|ThemeProvider|color|styles|utils|hooks\/use(?:IsClient|NativeButton|TextOverflow)|icons\/lucideExtra|base-ui\/(?:ActionIcon|Avatar|Button|Checkbox|ContextMenu|Modal|Popover|Switch|Text|Toast|Tooltip|controlSize|focusRing|zIndex))(?:\/|\.)/;

const isUiCoreModule = (id: string) => {
  const member = id.replaceAll('\\', '/').split('/node_modules/@lobehub/ui/es/')[1];

  return Boolean(member && UI_CORE_MEMBER_RE.test(member));
};

// Rolldown groups also capture their modules' dependencies; a higher priority
// keeps the explicit groups above (and antd) from being pulled into ui-core.
export const createSharedRolldownOutput = (options: SharedRolldownOutputOptions = {}) => ({
  chunkFileNames: sharedChunkFileNames,
  strictExecutionOrder: options.strictExecutionOrder ?? true,
  codeSplitting: {
    groups: [
      {
        name: (moduleId: string) => sharedManualChunks(moduleId) ?? null,
        priority: 3,
      },
      {
        name: 'vendor-antd',
        priority: 2,
        test: /[\\/]node_modules[\\/](?:antd|@ant-design|@rc-component)[\\/]/,
      },
      { name: 'vendor-ui-core', priority: 1, test: isUiCoreModule },
    ],
  },
});

type Platform = 'web' | 'mobile' | 'desktop' | 'auth';

const isDev = process.env.NODE_ENV !== 'production';

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
    viteStaticStylesPrecompile(),
    ...(options.platform === 'desktop' ? [] : [...lobeIconImports(), ...lobeUiImports()]),
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
    '__REACT_SCAN__': process.env.REACT_SCAN === 'true' ? 'true' : 'false',
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
    '@lobehub/ui/base-ui',
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

// Workspace packages can resolve @lobehub/editor through different peer-dependency
// snapshots. They must still share one LexicalComposerContext at runtime.
export const sharedRendererDedupe = ['@lobehub/editor', 'react', 'react-dom'];

export const __testing = { isUiCoreModule, sharedChunkFileNames, sharedManualChunks };
