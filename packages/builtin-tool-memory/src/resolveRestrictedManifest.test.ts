import { describe, expect, it } from 'vitest';

import { memoryReadOnlySystemPrompt } from './readOnlySystemRole';
import { resolveMemoryRestrictedManifest } from './resolveRestrictedManifest';
import { MEMORY_READ_API_NAMES, MEMORY_WRITE_API_NAMES, MemoryApiName } from './types';

describe('resolveMemoryRestrictedManifest', () => {
  it('returns the read-only Share manifest for the exact API set regardless of order', () => {
    const manifest = resolveMemoryRestrictedManifest({
      allowedApiNames: [...MEMORY_READ_API_NAMES].reverse(),
      restriction: 'agentShare',
    });

    expect(manifest?.api.map((api) => api.name).sort()).toEqual([...MEMORY_READ_API_NAMES].sort());
    expect(manifest?.systemRole).toBe(memoryReadOnlySystemPrompt);
  });

  it('fails closed for unknown subsets and non-Share restrictions', () => {
    expect(
      resolveMemoryRestrictedManifest({
        allowedApiNames: [MemoryApiName.searchUserMemory],
        restriction: 'agentShare',
      }),
    ).toBeUndefined();
    expect(
      resolveMemoryRestrictedManifest({
        allowedApiNames: [...MEMORY_READ_API_NAMES],
        restriction: 'toolSelection',
      }),
    ).toBeUndefined();
  });

  it('documents retrieval without advertising memory writes', () => {
    for (const apiName of MEMORY_READ_API_NAMES) {
      expect(memoryReadOnlySystemPrompt).toContain(apiName);
    }
    for (const apiName of MEMORY_WRITE_API_NAMES) {
      expect(memoryReadOnlySystemPrompt).not.toContain(apiName);
    }
  });
});
