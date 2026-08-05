import '@testing-library/jest-dom';
// mock indexedDB to test with dexie
// refs: https://github.com/dumbmatter/fakeIndexedDB#dexie-and-other-indexeddb-api-wrappers
import 'fake-indexeddb/auto';

import { theme } from 'antd';
import i18n from 'i18next';
import { enableMapSet, enablePatches } from 'immer';
import type { ButtonHTMLAttributes, ComponentType, ElementType, ReactNode } from 'react';
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

type NativeButtonType = 'button' | 'submit' | 'reset';
type TestButtonIcon = ComponentType<{ size?: number }> | ReactNode;

interface TestBaseUIButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  block?: boolean;
  color?: string;
  danger?: boolean;
  fill?: string;
  ghost?: boolean;
  htmlType?: NativeButtonType;
  icon?: TestButtonIcon;
  iconPosition?: 'end' | 'start';
  iconProps?: Record<string, unknown>;
  loading?: boolean;
  shadow?: boolean;
  size?: string;
  type?: string;
  variant?: string;
}

interface TestBaseUISwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'defaultValue' | 'onChange' | 'onClick' | 'value'
> {
  checked?: boolean;
  checkedChildren?: ReactNode;
  defaultChecked?: boolean;
  defaultValue?: boolean;
  loading?: boolean;
  onChange?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  onClick?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  size?: string;
  unCheckedChildren?: ReactNode;
  value?: boolean;
}

const getNativeButtonType = (type?: string): NativeButtonType =>
  type === 'submit' || type === 'reset' ? type : 'button';

const renderTestButtonIcon = (icon?: TestButtonIcon) => {
  if (!icon) return null;

  if (React.isValidElement(icon)) return icon;

  return typeof icon === 'function' || (typeof icon === 'object' && '$$typeof' in icon)
    ? React.createElement(icon as ElementType<{ size?: number }>, { size: 16 })
    : icon;
};

const TestBaseUIButton = (props: TestBaseUIButtonProps) => {
  const {
    block: _block,
    children,
    color: _color,
    danger: _danger,
    disabled,
    fill: _fill,
    ghost: _ghost,
    htmlType,
    icon,
    iconPosition = 'start',
    iconProps: _iconProps,
    loading,
    shadow: _shadow,
    size: _size,
    type,
    variant: _variant,
    ...buttonProps
  } = props;
  const renderedIcon = renderTestButtonIcon(icon);
  const nativeType = htmlType ?? getNativeButtonType(type);

  return React.createElement(
    'button',
    {
      ...buttonProps,
      'aria-busy': loading || undefined,
      'disabled': disabled || loading,
      'type': nativeType,
    },
    iconPosition === 'end' ? children : renderedIcon,
    iconPosition === 'end' ? renderedIcon : children,
  );
};

const TestBaseUISwitch = (props: TestBaseUISwitchProps) => {
  const {
    checked,
    checkedChildren,
    defaultChecked,
    defaultValue,
    disabled,
    loading,
    onChange,
    onClick,
    size: _size,
    unCheckedChildren,
    value,
    ...buttonProps
  } = props;
  const [innerChecked, setInnerChecked] = React.useState(defaultValue ?? defaultChecked ?? false);
  const currentChecked = value ?? checked ?? innerChecked;

  return React.createElement(
    'button',
    {
      ...buttonProps,
      'aria-busy': loading || undefined,
      'aria-checked': currentChecked,
      'disabled': disabled || loading,
      'role': 'switch',
      'type': 'button',
      'onClick': (event: React.MouseEvent<HTMLButtonElement>) => {
        const nextChecked = !currentChecked;

        if (value === undefined && checked === undefined) {
          setInnerChecked(nextChecked);
        }

        onChange?.(nextChecked, event);
        onClick?.(nextChecked, event);
      },
    },
    currentChecked ? checkedChildren : unCheckedChildren,
  );
};

// base-ui Button requires the app-level motion provider. Unit tests exercise
// consuming components, so a native button keeps interaction behavior stable.
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    Button: TestBaseUIButton,
    Switch: TestBaseUISwitch,
  };
});

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
