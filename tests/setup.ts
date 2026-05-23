import '@testing-library/jest-dom';
// mock indexedDB to test with dexie
// refs: https://github.com/dumbmatter/fakeIndexedDB#dexie-and-other-indexeddb-api-wrappers
import 'fake-indexeddb/auto';

import { theme } from 'antd';
import i18n from 'i18next';
import { enableMapSet, enablePatches } from 'immer';
import React from 'react';
import { beforeEach, vi } from 'vitest';

import chat from '@/locales/default/chat';
import common from '@/locales/default/common';
import discover from '@/locales/default/discover';
import home from '@/locales/default/home';
import oauth from '@/locales/default/oauth';

class TestMemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

const installTestStorage = () => {
  const localStorage = new TestMemoryStorage();
  const sessionStorage = new TestMemoryStorage();

  Object.defineProperties(globalThis, {
    Storage: { configurable: true, value: TestMemoryStorage, writable: true },
    localStorage: { configurable: true, value: localStorage, writable: true },
    sessionStorage: { configurable: true, value: sessionStorage, writable: true },
  });

  if (typeof globalThis.window !== 'undefined') {
    Object.defineProperties(window, {
      localStorage: { configurable: true, value: localStorage, writable: true },
      sessionStorage: { configurable: true, value: sessionStorage, writable: true },
    });
  }
};

// Enable Immer MapSet plugin so store code using Map/Set in produce() works in tests
enablePatches();
enableMapSet();

// Global mock for @lobehub/analytics/react to avoid AnalyticsProvider dependency
// This prevents tests from failing when components use useAnalytics hook
vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => ({
    analytics: {
      track: vi.fn(),
    },
  }),
}));

// Global mock for @/auth to avoid better-auth validator module issue in tests
// The validator package has ESM resolution issues in Vitest environment
vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// node runtime
if (typeof globalThis.window === 'undefined') {
  // test with polyfill crypto
  const { Crypto } = await import('@peculiar/webcrypto');

  Object.defineProperty(globalThis, 'crypto', {
    value: new Crypto(),
    writable: true,
  });
}

installTestStorage();
beforeEach(installTestStorage);

// remove antd hash on test
theme.defaultConfig.hashed = false;

// init i18n for non-React modules (stores/utils) using i18next.t(...)
// Use in-memory resources to avoid interfering with Vitest module mocking.
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

// Set React as a global variable so it doesn't need to be imported in each test file
(globalThis as any).React = React;
