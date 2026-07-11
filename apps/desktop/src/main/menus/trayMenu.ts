import type { TrayNavigationSnapshot } from '@lobechat/electron-client-ipc';
import type { MenuItemConstructorOptions } from 'electron';
import { app as electronApp } from 'electron';

import type { App } from '@/core/App';

const PINNED_LIMIT = 3;
const RECENT_AGENT_LIMIT = 3;
const RECENT_LIMIT = 5;

const openRoute = (app: App, path: string) => {
  const mainWindow = app.browserManager.getMainWindow();
  mainWindow.show();
  mainWindow.broadcast('navigate', { escape: true, path });
};

const createSection = (
  label: string,
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] =>
  items.length > 0 ? [{ enabled: false, label }, ...items, { type: 'separator' }] : [];

export const buildTrayMenuTemplate = (
  app: App,
  snapshot: TrayNavigationSnapshot,
): MenuItemConstructorOptions[] => {
  const t = app.i18n.ns('menu');
  const appName = electronApp.getName();
  const pinnedItems = snapshot.pinned.slice(0, PINNED_LIMIT).map(({ title, url }) => ({
    click: () => openRoute(app, url),
    label: title,
  }));
  const agentItems: MenuItemConstructorOptions[] = snapshot.agents
    .slice(0, RECENT_AGENT_LIMIT)
    .map(({ title, url }) => ({ click: () => openRoute(app, url), label: title }));
  const recentItems: MenuItemConstructorOptions[] = snapshot.recent
    .slice(0, RECENT_LIMIT)
    .map(({ subtitle, title, url }) => ({
      click: () => openRoute(app, url),
      label: title,
      sublabel: subtitle,
    }));

  if (snapshot.agents.length > RECENT_AGENT_LIMIT) {
    agentItems.push({
      click: () => {
        app.browserManager.showMainWindow();
        app.browserManager.getMainWindow().broadcast('openAllAgents');
      },
      label: t('tray.moreAgents'),
    });
  }

  if (snapshot.recent.length > RECENT_LIMIT) {
    recentItems.push({
      click: () => {
        app.browserManager.showMainWindow();
        app.browserManager.getMainWindow().broadcast('openRecentlyViewed');
      },
      label: t('tray.more'),
    });
  }

  return [
    ...createSection(t('tray.pinned'), pinnedItems),
    ...createSection(t('tray.recentAgents'), agentItems),
    ...createSection(t('tray.recent'), recentItems),
    {
      accelerator: 'Alt+Shift+Space',
      click: () => app.screenCaptureManager.startSession(),
      label: t('tray.openMiniToolbar'),
    },
    {
      click: () => app.browserManager.openQuickChatPopup(),
      label: t('tray.quickChat'),
    },
    {
      click: () => {
        const mainWindow = app.browserManager.getMainWindow();
        mainWindow.show();
        mainWindow.broadcast('createNewTopic');
      },
      label: t('tray.newChat'),
    },
    { type: 'separator' },
    {
      click: () => app.browserManager.showMainWindow(),
      label: t('tray.open', { appName }),
    },
    {
      click: () => openRoute(app, '/settings'),
      label: t('tray.settings'),
    },
    { type: 'separator' },
    { label: t('tray.quit'), role: 'quit' },
  ];
};
