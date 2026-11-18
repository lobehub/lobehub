import { describe, expect, it } from 'vitest';

import { findMissingPinnedTools } from './missingPinnedTools';

describe('findMissingPinnedTools', () => {
  it('reports pinned tools that no source produced a manifest for', () => {
    expect(
      findMissingPinnedTools({
        disabledPluginIds: [],
        filteredTools: [
          { id: 'posthog', reason: 'not_found' },
          { id: 'posthog', reason: 'not_found' },
          { id: 'lobe-knowledge-base', reason: 'disabled' },
          { id: 'lobe-default-tool', reason: 'not_found' },
        ],
        pinnedPluginIds: ['posthog', 'lobe-knowledge-base'],
      }),
    ).toEqual(['posthog']);
  });

  it('skips tools the user disabled for the run', () => {
    expect(
      findMissingPinnedTools({
        disabledPluginIds: ['posthog'],
        filteredTools: [{ id: 'posthog', reason: 'not_found' }],
        pinnedPluginIds: ['posthog'],
      }),
    ).toEqual([]);
  });

  it('returns nothing when the engine filtered nothing', () => {
    expect(
      findMissingPinnedTools({
        disabledPluginIds: [],
        filteredTools: undefined,
        pinnedPluginIds: ['posthog'],
      }),
    ).toEqual([]);
  });
});
