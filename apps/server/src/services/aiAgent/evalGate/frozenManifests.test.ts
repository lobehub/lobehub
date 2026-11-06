import { generateToolsFromManifest } from '@lobechat/context-engine';
import { expect, it } from 'vitest';

import type { ShareGateToolSet } from '../shareGate/types';
import { applyFrozenEvalManifests } from './frozenManifests';

it('restores original native contracts after device filtering and dispatches through the server hook', () => {
  const original = {
    identifier: 'lobe-local-system',
    type: 'builtin' as const,
    meta: { title: 'Local System' },
    api: [
      { name: 'readFile', description: 'Original description', parameters: { type: 'object' } },
    ],
  };
  const stale = {
    ...original,
    meta: { title: 'LobeBench Mock' },
    api: [...original.api, { name: 'unrelated', description: '', parameters: {} }],
  };
  const set: ShareGateToolSet = {
    manifestMap: { [original.identifier]: stale },
    executorMap: { [original.identifier]: 'client' },
    sourceMap: {},
    tools: generateToolsFromManifest(stale),
    enabledToolIds: [],
    activatableToolIds: [],
  };
  applyFrozenEvalManifests(set, [original]);
  expect(set.manifestMap[original.identifier]).toEqual(original);
  expect(set.tools).toEqual(generateToolsFromManifest(original));
  expect(set.executorMap[original.identifier]).toBe('server');
  expect(set.enabledToolIds).toEqual([original.identifier]);
  expect(JSON.stringify(set)).not.toContain('Mock');
  applyFrozenEvalManifests(set, [original]);
  expect(set.tools).toHaveLength(1);
});
