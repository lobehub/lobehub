import { describe, expect, it } from 'vitest';

import { resolveChannelHeaderView } from './headerView';

describe('resolveChannelHeaderView', () => {
  it('keeps the detail breadcrumb while platform definitions are still loading', () => {
    expect(resolveChannelHeaderView('telegram', undefined, true)).toEqual({
      detail: true,
      platformName: undefined,
    });
  });

  it('names the platform once its definition is loaded', () => {
    expect(resolveChannelHeaderView('telegram', { name: 'Telegram' }, false)).toEqual({
      detail: true,
      platformName: 'Telegram',
    });
  });

  it('falls back to the route id for an unknown platform once loading settles', () => {
    expect(resolveChannelHeaderView('unknown', undefined, false)).toEqual({
      detail: true,
      platformName: 'unknown',
    });
  });

  it('treats a loaded definition without a route id as a detail page', () => {
    expect(resolveChannelHeaderView(undefined, { name: 'Discord' }, false)).toEqual({
      detail: true,
      platformName: 'Discord',
    });
  });

  it('shows the tab switcher on the platform list', () => {
    expect(resolveChannelHeaderView(undefined, undefined, false)).toEqual({
      detail: false,
      platformName: undefined,
    });
  });
});
