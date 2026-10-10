import type { TrayActiveTopicItem, TrayNavigationSnapshot } from '@lobechat/electron-client-ipc';
import type { MenuItemConstructorOptions } from 'electron';
import { app as electronApp } from 'electron';

import type { App } from '@/core/App';

const ACTIVE_LIMIT = 5;
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

export const buildDockMenuTemplate = (
  app: App,
  snapshot: TrayNavigationSnapshot,
  { includeAgents = false }: { includeAgents?: boolean } = {},
): MenuItemConstructorOptions[] => {
  const t = app.i18n.ns('menu');
  const activeItems = (status: TrayActiveTopicItem['status']) =>
    (snapshot.activeTopics ?? [])
      .filter((topic) => topic.status === status)
      .slice(0, ACTIVE_LIMIT)
      .map(({ subtitle, title, url }) => ({
        click: () => openRoute(app, url),
        label: title,
        sublabel: subtitle,
      }));
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

  return [
    ...createSection(t('tray.waitingForHuman'), activeItems('waitingForHuman')),
    ...createSection(t('tray.running'), activeItems('running')),
    ...createSection(t('tray.pinned'), pinnedItems),
    ...(includeAgents ? createSection(t('tray.recentAgents'), agentItems) : []),
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
  ];
};

export const buildTrayMenuTemplate = (
  app: App,
  snapshot: TrayNavigationSnapshot,
): MenuItemConstructorOptions[] => {
  const t = app.i18n.ns('menu');
  const appName = electronApp.getName();

  return [
    ...buildDockMenuTemplate(app, snapshot, { includeAgents: true }),
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
