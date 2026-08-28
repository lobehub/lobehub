import { Menu } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { I18nManager } from '@/core/infrastructure/I18nManager';

import { MacOSMenu } from './macOS';

const { mockAppModule } = vi.hoisted(() => ({
  mockAppModule: {
    dock: { setMenu: vi.fn() },
    getAppPath: vi.fn(() => '/mock/app/path'),
    getLocale: vi.fn(() => 'en-US'),
    getName: vi.fn(() => 'LobeHub'),
    getPath: vi.fn((type: string) => `/mock/path/${type}`),
    getPreferredSystemLanguages: vi.fn(() => ['en-US']),
  },
}));

vi.mock('electron', () => ({
  app: mockAppModule,
  Menu: {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn(() => Promise.resolve('')) },
}));

vi.mock('electron-is', () => ({ macOS: vi.fn(() => true) }));

vi.mock('@/const/env', () => ({ isDev: false }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createAppCore = () => {
  const appCore = {
    browserManager: {
      getMainWindow: vi.fn(() => ({ broadcast: vi.fn(), loadUrl: vi.fn(), show: vi.fn() })),
      retrieveByIdentifier: vi.fn(() => ({ show: vi.fn() })),
      showMainWindow: vi.fn(),
    },
    menuManager: { rebuildAppMenu: vi.fn(), refreshMenus: vi.fn() },
    screenCaptureManager: { startSession: vi.fn() },
    storeManager: { get: vi.fn(() => 'auto'), openInEditor: vi.fn(), set: vi.fn() },
    updaterManager: { getUpdaterState: vi.fn(() => ({ stage: 'idle' })) },
  } as unknown as App;

  return appCore;
};

const buildMenuLabels = async () => {
  const appCore = createAppCore();
  const i18n = new I18nManager(appCore);
  await i18n.init();
  (appCore as any).i18n = i18n;

  new MacOSMenu(appCore).buildAndSetAppMenu();

  // buildAndSetAppMenu also builds the dock menu; the app menu is built first
  const template = (Menu.buildFromTemplate as any).mock.calls[0][0];

  return {
    topLevel: template.map((item: any) => item.label),
    windowSubmenu: template
      .find((item: any) => item.role === 'windowMenu')
      .submenu.map((item: any) => item.label)
      .filter(Boolean),
  };
};

describe('macOS menu bar language on first launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppModule.getName.mockReturnValue('LobeHub');
  });

  it('renders the menu bar in the OS language when nothing is stored yet', async () => {
    // A packaged build reports en-US here because `electronLanguages` prunes the
    // app's locales — the OS language is the only trustworthy signal.
    mockAppModule.getLocale.mockReturnValue('en-US');
    mockAppModule.getPreferredSystemLanguages.mockReturnValue(['zh-Hans-CN']);

    const { topLevel, windowSubmenu } = await buildMenuLabels();

    expect(topLevel).toEqual(['LobeHub', '文件', '编辑', '视图', '前往', '窗口', '帮助']);
    expect(windowSubmenu).toEqual(['最小化', '缩放', '前置所有窗口']);
  });

  it('still renders English on an English system', async () => {
    mockAppModule.getLocale.mockReturnValue('en-US');
    mockAppModule.getPreferredSystemLanguages.mockReturnValue(['en-US']);

    const { topLevel, windowSubmenu } = await buildMenuLabels();

    expect(topLevel).toEqual(['LobeHub', 'File', 'Edit', 'View', 'Go', 'Window', 'Help']);
    expect(windowSubmenu).toEqual(['Minimize', 'Zoom', 'Bring All Windows to Front']);
  });
});
