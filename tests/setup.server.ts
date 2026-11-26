/**
 * Setup for the `server` project (apps/server, node environment).
 *
 * tests/setup.ts prepares a browser for the app project: jest-dom matchers,
 * fake IndexedDB, Web Storage, a WebCrypto polyfill, React and @lobehub/ui
 * stubs. Server tests use none of it, yet every server test file paid to
 * import and run it. This keeps only what server code relies on: Immer's
 * Map/Set and patches support, the auth stub, and the shared i18next instance
 * (fetch-sse and the locale helpers translate through it).
 */
import i18n from 'i18next';
import { enableMapSet, enablePatches } from 'immer';
import { vi } from 'vitest';

import chat from '@/locales/default/chat';
import common from '@/locales/default/common';
import discover from '@/locales/default/discover';
import home from '@/locales/default/home';
import oauth from '@/locales/default/oauth';

enablePatches();
enableMapSet();

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock('zustand/traditional');

await i18n.init({
  defaultNS: 'common',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  lng: 'zh-CN',
  ns: ['common', 'chat', 'discover', 'home', 'oauth'],
  resources: {
    'zh-CN': {
      chat,
      common,
      discover,
      home,
      oauth,
    },
  },
});
