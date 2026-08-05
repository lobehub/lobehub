import { describe, expect, it } from 'vitest';

import {
  getActivePluginIds,
  getDisabledPluginIds,
  getPinnedPluginIds,
  getPluginMode,
  parsePluginEntry,
  upsertPluginMode,
} from './pluginConfig';

describe('parsePluginEntry', () => {
  it('resolves a legacy string entry as pinned', () => {
    expect(parsePluginEntry('web-search')).toEqual({ identifier: 'web-search', mode: 'pinned' });
  });

  it('resolves an object entry with no mode as pinned', () => {
    expect(parsePluginEntry({ identifier: 'web-search' })).toEqual({
      identifier: 'web-search',
      mode: 'pinned',
    });
  });

  it('resolves an object entry with an explicit mode', () => {
    expect(parsePluginEntry({ identifier: 'web-search', mode: 'auto' })).toEqual({
      identifier: 'web-search',
      mode: 'auto',
    });
    expect(parsePluginEntry({ identifier: 'web-search', mode: 'disabled' })).toEqual({
      identifier: 'web-search',
      mode: 'disabled',
    });
    expect(parsePluginEntry({ identifier: 'web-search', mode: 'pinned' })).toEqual({
      identifier: 'web-search',
      mode: 'pinned',
    });
  });
});

describe('getPluginMode', () => {
  it('returns auto when plugins is undefined', () => {
    expect(getPluginMode(undefined, 'web-search')).toBe('auto');
  });

  it('returns auto when the identifier is not present', () => {
    expect(getPluginMode(['a', 'b'], 'web-search')).toBe('auto');
  });

  it('returns pinned for a legacy string entry', () => {
    expect(getPluginMode(['web-search'], 'web-search')).toBe('pinned');
  });

  it('returns the explicit mode for an object entry', () => {
    expect(getPluginMode([{ identifier: 'web-search', mode: 'disabled' }], 'web-search')).toBe(
      'disabled',
    );
  });

  it('resolves correctly within a mixed-shape array', () => {
    const plugins = [
      'legacy-a',
      { identifier: 'disabled-b', mode: 'disabled' as const },
      { identifier: 'pinned-c', mode: 'pinned' as const },
    ];

    expect(getPluginMode(plugins, 'legacy-a')).toBe('pinned');
    expect(getPluginMode(plugins, 'disabled-b')).toBe('disabled');
    expect(getPluginMode(plugins, 'pinned-c')).toBe('pinned');
    expect(getPluginMode(plugins, 'not-there')).toBe('auto');
  });
});

describe('getPinnedPluginIds / getDisabledPluginIds / getActivePluginIds', () => {
  const plugins = [
    'legacy-a',
    { identifier: 'disabled-b', mode: 'disabled' as const },
    { identifier: 'pinned-c', mode: 'pinned' as const },
    { identifier: 'auto-d', mode: 'auto' as const },
  ];

  it('collects pinned identifiers, including legacy strings and mode-less objects', () => {
    expect(getPinnedPluginIds(plugins)).toEqual(['legacy-a', 'pinned-c']);
  });

  it('collects disabled identifiers', () => {
    expect(getDisabledPluginIds(plugins)).toEqual(['disabled-b']);
  });

  it('getActivePluginIds mirrors getPinnedPluginIds', () => {
    expect(getActivePluginIds(plugins)).toEqual(getPinnedPluginIds(plugins));
  });

  it('returns an empty array for undefined input', () => {
    expect(getPinnedPluginIds(undefined)).toEqual([]);
    expect(getDisabledPluginIds(undefined)).toEqual([]);
    expect(getActivePluginIds(undefined)).toEqual([]);
  });
});

describe('upsertPluginMode', () => {
  it('appends a new object entry when the identifier is absent', () => {
    expect(upsertPluginMode(['a'], 'b', 'disabled')).toEqual([
      'a',
      { identifier: 'b', mode: 'disabled' },
    ]);
  });

  it('updates an existing object entry in place, preserving other fields', () => {
    const plugins = [{ identifier: 'a', mode: 'pinned' as const, extra: 'keep-me' } as any];

    expect(upsertPluginMode(plugins, 'a', 'disabled')).toEqual([
      { identifier: 'a', mode: 'disabled', extra: 'keep-me' },
    ]);
  });

  it('upgrades a touched legacy string entry to an object, leaving others as strings', () => {
    const plugins = ['a', 'b', 'c'];

    expect(upsertPluginMode(plugins, 'b', 'disabled')).toEqual([
      'a',
      { identifier: 'b', mode: 'disabled' },
      'c',
    ]);
  });

  it('never mutates the input array', () => {
    const plugins = ['a', 'b'];
    const result = upsertPluginMode(plugins, 'a', 'disabled');

    expect(plugins).toEqual(['a', 'b']);
    expect(result).not.toBe(plugins);
  });

  it('handles undefined input by creating a new array', () => {
    expect(upsertPluginMode(undefined, 'a', 'pinned')).toEqual([
      { identifier: 'a', mode: 'pinned' },
    ]);
  });

  it('removes the entry (legacy string or object) when set to auto, instead of persisting it', () => {
    expect(upsertPluginMode(['a', 'b'], 'a', 'auto')).toEqual(['b']);
    expect(
      upsertPluginMode([{ identifier: 'a', mode: 'disabled' as const }, 'b'], 'a', 'auto'),
    ).toEqual(['b']);
  });

  it('is a no-op when setting auto on an identifier that is already absent', () => {
    expect(upsertPluginMode(['a'], 'not-there', 'auto')).toEqual(['a']);
  });
});
