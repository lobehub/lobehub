import { describe, expect, it } from 'vitest';

import { initialState } from '@/store/tool/initialState';

import { buildRunManifestMap } from './discoverableManifests';

const builtin = (identifier: string, discoverable?: boolean) =>
  ({
    discoverable,
    identifier,
    manifest: { api: [], identifier, meta: {}, type: 'builtin' },
    type: 'builtin',
  }) as any;

describe('buildRunManifestMap', () => {
  const state = {
    ...initialState,
    builtinTools: [
      builtin('test-enabled'),
      builtin('test-discoverable'),
      builtin('test-hidden', false),
    ],
  } as any;

  it('keeps discoverable tools so a tool activated mid-run is not treated as unknown', () => {
    const enabled = { api: [{ name: 'run' }], identifier: 'test-enabled' } as any;

    const map = buildRunManifestMap(state, [enabled]);

    expect(map['test-enabled']).toBe(enabled);
    expect(map['test-discoverable']?.identifier).toBe('test-discoverable');
    expect(map['test-hidden']).toBeUndefined();
  });
});
