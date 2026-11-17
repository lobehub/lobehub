import { describe, expect, it } from 'vitest';

import { getProjectCoordinatorSettingsPath } from '../Layout/navigation';
import { isCoordinatorSettingsView, resolveCoordinatorRedirect } from './views';

describe('resolveCoordinatorRedirect', () => {
  it.each([
    ['/agent/agt_1/profile', { view: 'basic' }],
    ['/agent/agt_1/instruction', { view: 'basic' }],
    ['/agent/agt_1/engine', { view: 'basic' }],
    ['/agent/agt_1/settings', { view: 'basic' }],
    ['/agent/agt_1/tools', { view: 'tools' }],
    ['/agent/agt_1/skills', { view: 'skills' }],
    ['/agent/agt_1/knowledge', { view: 'knowledge' }],
    ['/agent/agt_1/environment', { view: 'environment' }],
    ['/agent/agt_1/channel', { view: 'channel' }],
    ['/agent/agt_1/channel/telegram', { platform: 'telegram', view: 'channel' }],
    ['/acme/agent/agt_1/channel/discord/', { platform: 'discord', view: 'channel' }],
  ])('maps the agent settings page %s into the project settings', (pathname, expected) => {
    expect(resolveCoordinatorRedirect(pathname)).toEqual(expected);
  });

  it.each([
    '/agent/agt_1',
    '/agent/agt_1/topics',
    '/agent/agt_1/tasks',
    '/agent/agt_1/statistics',
    '/agent/agt_1/share',
    '/project/prj_1/settings/agent',
  ])('leaves %s on the agent', (pathname) => {
    expect(resolveCoordinatorRedirect(pathname)).toBeUndefined();
  });
});

describe('getProjectCoordinatorSettingsPath', () => {
  it('opens the basic page without a query', () => {
    expect(getProjectCoordinatorSettingsPath('prj_1')).toBe('/project/prj_1/settings/agent');
    expect(getProjectCoordinatorSettingsPath('prj_1', { view: 'basic' })).toBe(
      '/project/prj_1/settings/agent',
    );
  });

  it('carries the page and IM platform', () => {
    expect(getProjectCoordinatorSettingsPath('prj_1', { view: 'tools' })).toBe(
      '/project/prj_1/settings/agent?view=tools',
    );
    expect(
      getProjectCoordinatorSettingsPath('prj_1', { platform: 'telegram', view: 'channel' }),
    ).toBe('/project/prj_1/settings/agent?view=channel&platform=telegram');
  });
});

describe('isCoordinatorSettingsView', () => {
  it('accepts known pages only', () => {
    expect(isCoordinatorSettingsView('channel')).toBe(true);
    expect(isCoordinatorSettingsView('automations')).toBe(false);
    expect(isCoordinatorSettingsView(null)).toBe(false);
  });
});
