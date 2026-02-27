import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';

import { viteEmotionSpeedy } from './emotionSpeedy';
import { viteNodeModuleStub } from './nodeModuleStub';
import { vitePlatformResolve } from './platformResolve';

/**
 * Shared manualChunks — groups leaf-node modules to reduce chunk file count.
 * Only targets pure data modules (no downstream dependents) to avoid facade chunk issues.
 */
/** Large i18n namespaces that get their own per-locale chunk instead of merging into the locale bundle */
const HEAVY_NS = new Set(['models', 'modelProvider']);

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

function sharedManualChunks(id: string): string | undefined {
  // i18n locale JSON/TS files
  const localeMatch = id.match(/\/locales\/([^/]+)\/([^/.]+)/);
  if (localeMatch) {
    const [, locale, ns] = localeMatch;
    if (locale === 'default') return 'i18n-default';
    if (HEAVY_NS.has(ns)) return `i18n-${locale}-${ns}`;
    return `i18n-${locale}`;
  }

  // model-bank (monorepo package — split before node_modules guard)
  if (id.includes('model-bank')) return 'providerConfig';

  if (!id.includes('node_modules')) return;

  // antd locale → merge into i18n-{locale}
  const antdMatch = id.match(/antd\/es\/locale\/([^/.]+)\.js/);
  if (antdMatch) {
    const locale = ANTD_LOCALE[antdMatch[1]];
    if (locale) return `i18n-${locale}`;
  }

  // dayjs core — keep out of locale chunks so entry doesn't statically pull i18n-ar
  if (id.includes('/dayjs/') && !id.includes('/dayjs/locale/')) return 'vendor-dayjs';

  // dayjs locale → merge into i18n-{locale}
  const dayjsMatch = id.match(/dayjs\/locale\/([^/.]+)\.js/);
  if (dayjsMatch) {
    const locale = DAYJS_LOCALE[dayjsMatch[1]];
    if (locale) return `i18n-${locale}`;
  }

  // Lucide icons
  if (id.includes('lucide-react')) return 'vendor-icons';

  // es-toolkit
  if (id.includes('es-toolkit')) return 'vendor-es-toolkit';

  // emotion (CSS-in-JS runtime)
  if (id.includes('@emotion/')) return 'vendor-emotion';

  // motion (framer-motion)
  if (id.includes('/motion/') || id.includes('framer-motion')) return 'vendor-motion';
}

export const sharedRollupOutput = {
  manualChunks: sharedManualChunks,
};

type Platform = 'web' | 'mobile' | 'desktop';

const isDev = process.env.NODE_ENV !== 'production';

interface SharedRendererOptions {
  platform: Platform;
  tsconfigPaths?: boolean;
}

export function sharedRendererPlugins(options: SharedRendererOptions) {
  const defaultTsconfigPaths = options.tsconfigPaths ?? true;
  return [
    viteEmotionSpeedy(),
    nodePolyfills({ include: ['buffer'] }),
    viteNodeModuleStub(),
    vitePlatformResolve(options.platform),
    defaultTsconfigPaths && tsconfigPaths({ projects: ['.'] }),
    isDev &&
      codeInspectorPlugin({
        bundler: 'vite',
        exclude: [/\.(css|json)$/],
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
    '__ELECTRON__': JSON.stringify(options.isElectron),
    '__MOBILE__': JSON.stringify(options.isMobile),
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
    'react-router-dom',
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

    'ahooks',
    'motion/react',

    // monorepo packages — pre-bundle to reduce request count
    '@lobechat/model-runtime',
    'model-bank',
    '@lobechat/types',
    '@lobechat/prompts',
    '@lobechat/context-engine',
    '@lobechat/utils',
    '@lobechat/const',
    '@lobechat/agent-runtime',
    '@lobechat/electron-client-ipc',
    '@lobechat/conversation-flow',
    '@lobechat/builtin-agents',
  ],
};
