import { APP_WINDOW_MIN_SIZE } from '@lobechat/desktop-bridge';

import type { BrowserWindowOpts } from './core/browser/Browser';

export const BrowsersIdentifiers = {
  app: 'app',
  devtools: 'devtools',
};

export const appBrowsers = {
  app: {
    autoHideMenuBar: true,
    height: 800,
    identifier: 'app',
    keepAlive: true,
    minHeight: APP_WINDOW_MIN_SIZE.height,
    minWidth: APP_WINDOW_MIN_SIZE.width,
    path: '/',
    showOnInit: true,
    titleBarStyle: 'hidden',
    width: 1200,
  },
  devtools: {
    autoHideMenuBar: true,
    fullscreenable: false,
    height: 600,
    identifier: 'devtools',
    maximizable: false,
    minWidth: 400,
    parentIdentifier: 'app',
    path: '/desktop/devtools',
    titleBarStyle: 'hiddenInset',
    width: 1000,
  },
} satisfies Record<string, BrowserWindowOpts>;

// Window templates for multi-instance windows
export interface WindowTemplate {
  allowMultipleInstances: boolean;
  autoHideMenuBar?: boolean;
  baseIdentifier: string;
  basePath: string;
  devTools?: boolean;
  height?: number;
  keepAlive?: boolean;
  minWidth?: number;
  parentIdentifier?: string;
  showOnInit?: boolean;
  title?: string;
  titleBarStyle?: 'hidden' | 'default' | 'hiddenInset' | 'customButtonsOnHover';
  // Note: vibrancy / visualEffectState / transparent are intentionally omitted.
  // Platform visual effects are managed exclusively by WindowThemeManager.
  width?: number;
}

export const windowTemplates = {
  chatSingle: {
    allowMultipleInstances: true,
    autoHideMenuBar: true,
    baseIdentifier: 'chatSingle',
    basePath: '/agent',
    height: 600,
    keepAlive: false, // Multi-instance windows don't need to stay alive
    minWidth: 400,
    parentIdentifier: 'app',
    titleBarStyle: 'hidden',
    width: 900,
  },
} satisfies Record<string, WindowTemplate>;

export type AppBrowsersIdentifiers = keyof typeof appBrowsers;
export type WindowTemplateIdentifiers = keyof typeof windowTemplates;
