import { describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import { buildTrayMenuTemplate } from './trayMenu';

const createApp = () => {
  const mainWindow = {
    broadcast: vi.fn(),
    show: vi.fn(),
  };
  const app = {
    browserManager: {
      getMainWindow: vi.fn(() => mainWindow),
      openQuickChatPopup: vi.fn(),
      showMainWindow: vi.fn(),
    },
    i18n: {
      ns: vi.fn(() => (key: string) => key),
    },
    screenCaptureManager: {
      startSession: vi.fn(),
    },
  } as unknown as App;

  return { app, mainWindow };
};

describe('buildTrayMenuTemplate', () => {
  it('keeps static actions when navigation data is empty', () => {
    const { app } = createApp();

    const template = buildTrayMenuTemplate(app, { agents: [], pinned: [], recent: [] });
    const labels = template.map((item) => item.label);

    expect(labels).toContain('tray.openMiniToolbar');
    expect(labels).toContain('tray.quickChat');
    expect(labels).toContain('tray.newChat');
    expect(labels).toContain('tray.settings');
    expect(labels).not.toContain('tray.pinned');
    expect(labels).not.toContain('tray.recentAgents');
    expect(labels).not.toContain('tray.recent');
  });

  it('limits dynamic sections and offers More only for agents', () => {
    const { app } = createApp();
    const template = buildTrayMenuTemplate(app, {
      agents: Array.from({ length: 4 }, (_, index) => ({
        id: `agent-${index}`,
        title: `Agent ${index}`,
        url: `/agent/agent-${index}`,
      })),
      pinned: Array.from({ length: 4 }, (_, index) => ({
        title: `Pinned ${index}`,
        url: `/page/pinned-${index}`,
      })),
      recent: Array.from({ length: 6 }, (_, index) => ({
        title: `Recent ${index}`,
        url: `/page/recent-${index}`,
      })),
    });
    const labels = template.map((item) => item.label);

    expect(labels.filter((label) => String(label).startsWith('Pinned '))).toHaveLength(3);
    expect(labels.filter((label) => String(label).startsWith('Agent '))).toHaveLength(3);
    expect(labels.filter((label) => String(label).startsWith('Recent '))).toHaveLength(5);
    expect(labels).toContain('tray.moreAgents');
    expect(labels).not.toContain('tray.more');
  });

  it('lists topics awaiting input before running ones, each capped', () => {
    const { app } = createApp();
    const template = buildTrayMenuTemplate(app, {
      activeTopics: [
        ...Array.from({ length: 6 }, (_, index) => ({
          status: 'running' as const,
          title: `Running ${index}`,
          url: `/agent/a/running-${index}`,
        })),
        { status: 'waitingForHuman', subtitle: 'Researcher', title: 'Deploy', url: '/agent/a/t' },
      ],
      agents: [],
      pinned: [],
      recent: [],
    });
    const labels = template.map((item) => item.label);

    expect(labels.slice(0, 3)).toEqual(['tray.waitingForHuman', 'Deploy', undefined]);
    expect(labels[3]).toBe('tray.running');
    expect(labels.filter((label) => String(label).startsWith('Running '))).toHaveLength(5);
    expect(template.find(({ label }) => label === 'Deploy')).toMatchObject({
      sublabel: 'Researcher',
    });
  });

  it('opens dynamic routes in the main window', () => {
    const { app, mainWindow } = createApp();
    const template = buildTrayMenuTemplate(app, {
      agents: [],
      pinned: [{ title: 'Pinned task', url: '/tasks/pinned' }],
      recent: [],
    });
    const item = template.find(({ label }) => label === 'Pinned task');

    item?.click?.(null as never, null as never, null as never);

    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.broadcast).toHaveBeenCalledWith('navigate', {
      escape: true,
      path: '/tasks/pinned',
    });
  });

  it('renders recent topics and pages as two-line native items', () => {
    const { app } = createApp();
    const template = buildTrayMenuTemplate(app, {
      agents: [],
      pinned: [],
      recent: [
        { subtitle: 'Researcher', title: 'Topic title', url: '/agent/agent-1/topic-1' },
        { subtitle: 'Page', title: 'Page title', url: '/page/page-1' },
      ],
    });

    expect(template.find(({ label }) => label === 'Topic title')).toMatchObject({
      sublabel: 'Researcher',
    });
    expect(template.find(({ label }) => label === 'Page title')).toMatchObject({
      sublabel: 'Page',
    });
  });

  it('keeps restoration and creation as separate actions', () => {
    const { app, mainWindow } = createApp();
    const template = buildTrayMenuTemplate(app, {
      agents: [{ id: 'agent-1', title: 'Researcher', url: '/agent/agent-1' }],
      pinned: [],
      recent: [],
    });

    template
      .find(({ label }) => label === 'Researcher')
      ?.click?.(null as never, null as never, null as never);
    expect(mainWindow.broadcast).toHaveBeenCalledWith('navigate', {
      escape: true,
      path: '/agent/agent-1',
    });
    expect(mainWindow.broadcast).not.toHaveBeenCalledWith('createNewTopic');

    template
      .find(({ label }) => label === 'tray.newChat')
      ?.click?.(null as never, null as never, null as never);
    expect(mainWindow.broadcast).toHaveBeenCalledWith('createNewTopic');
  });
});
