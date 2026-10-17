import { describe, expect, it } from 'vitest';

import { appTypeLabelKey, resolveAppListState } from './appList';

describe('appTypeLabelKey', () => {
  it('labels each app with its own type', () => {
    expect(appTypeLabelKey('web')).toBe('oauthApp.type.web');
    expect(appTypeLabelKey('device')).toBe('oauthApp.type.device');
    expect(appTypeLabelKey(null)).toBe('oauthApp.type.device');
  });
});

describe('resolveAppListState', () => {
  it('reads a failed load as an error, not as the empty state', () => {
    expect(resolveAppListState({ error: new Error('boom'), isLoading: false })).toBe('error');
  });

  it('keeps showing a cached list when a revalidation fails', () => {
    expect(resolveAppListState({ count: 2, error: new Error('boom'), isLoading: false })).toBe(
      'list',
    );
  });

  it('distinguishes loading, empty and populated', () => {
    expect(resolveAppListState({ isLoading: true })).toBe('loading');
    expect(resolveAppListState({ count: 0, isLoading: false })).toBe('empty');
    expect(resolveAppListState({ count: 1, isLoading: false })).toBe('list');
  });
});
