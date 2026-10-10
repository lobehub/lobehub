import { describe, expect, it } from 'vitest';

import { loadResources } from './resources';

describe('loadResources', () => {
  it('loads Russian tray menu labels instead of exposing translation keys', async () => {
    const menu = (await loadResources('ru-RU', 'menu')) as Record<string, string>;

    expect(menu['tray.more']).toBe('Ещё');
    expect(menu['tray.moreAgents']).toBe('Больше агентов');
    expect(menu['tray.newChat']).toBe('Новый чат');
    expect(menu['tray.pinned']).toBe('Закреплённые');
    expect(menu['tray.quickChat']).toBe('Быстрый чат');
    expect(menu['tray.recent']).toBe('Недавние');
    expect(menu['tray.recentAgents']).toBe('Недавние агенты');
    expect(menu['tray.settings']).toBe('Настройки');
  });
});
