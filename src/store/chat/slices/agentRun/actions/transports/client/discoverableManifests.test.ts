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

  it('omits catalog entries denied to this agent and includes eligible contextual readers', () => {
    const reader = builtin('lobe-attachments', false).manifest;
    const map = buildRunManifestMap(state, new Map([[reader.identifier, reader]]), []);
    expect(Object.keys(map)).toEqual(['lobe-attachments']);
  });

  it('keeps discoverable tools so a tool activated mid-run is not treated as unknown', () => {
    const enabled = { api: [{ name: 'run' }], identifier: 'test-enabled' } as any;

    const map = buildRunManifestMap(
      state,
      new Map(
        state.builtinTools.map((tool: ReturnType<typeof builtin>) => [
          tool.identifier,
          tool.manifest,
        ]),
      ),
      [enabled],
    );

    expect(map['test-enabled']).toBe(enabled);
    expect(map['test-discoverable']?.identifier).toBe('test-discoverable');
    expect(map['test-hidden']).toBeUndefined();
  });
});
