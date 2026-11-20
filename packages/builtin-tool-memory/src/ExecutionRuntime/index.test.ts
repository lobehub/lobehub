import { describe, expect, it, vi } from 'vitest';

import type { UpdateIdentityMemoryParams } from '../types';
import { MemoryExecutionRuntime, type MemoryRuntimeService } from './index';

const createService = (overrides: Partial<MemoryRuntimeService> = {}): MemoryRuntimeService =>
  ({
    addActivityMemory: vi.fn(),
    addContextMemory: vi.fn(),
    addExperienceMemory: vi.fn(),
    addIdentityMemory: vi.fn(),
    addPreferenceMemory: vi.fn(),
    queryTaxonomyOptions: vi.fn(),
    removeIdentityMemory: vi.fn(),
    searchMemory: vi.fn(),
    updateIdentityMemory: vi.fn(),
    ...overrides,
  }) as MemoryRuntimeService;

describe('MemoryExecutionRuntime', () => {
  it('normalizes missing preference sourceIds before calling the service', async () => {
    const addPreferenceMemory = vi.fn().mockResolvedValue({
      memoryId: 'memory-1',
      message: 'saved',
      preferenceId: 'preference-1',
      success: true,
    });
    const runtime = new MemoryExecutionRuntime({
      service: createService({ addPreferenceMemory }),
    });

    const result = await runtime.addPreferenceMemory({
      details: 'The user prefers concise answers.',
      memoryCategory: 'communication',
      memoryType: 'preference',
      summary: 'The user prefers concise answers.',
      tags: ['communication'],
      title: 'Concise answers',
      withPreference: {
        appContext: null,
        conclusionDirectives: 'Keep answers concise.',
        extractedLabels: ['concise'],
        extractedScopes: [],
        originContext: null,
        scorePriority: 0.7,
        suggestions: [],
        type: 'communication',
      },
    } as never);

    expect(result.success).toBe(true);
    expect(addPreferenceMemory).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: [] }));
  });

  it('rejects invalid preference array fields before calling the service', async () => {
    const addPreferenceMemory = vi.fn();
    const runtime = new MemoryExecutionRuntime({
      service: createService({ addPreferenceMemory }),
    });

    const result = await runtime.addPreferenceMemory({
      details: 'The user prefers concise answers.',
      memoryCategory: 'communication',
      memoryType: 'preference',
      sourceIds: [],
      summary: 'The user prefers concise answers.',
      tags: 'communication',
      title: 'Concise answers',
      withPreference: {
        appContext: null,
        conclusionDirectives: 'Keep answers concise.',
        extractedLabels: ['concise'],
        extractedScopes: [],
        originContext: null,
        scorePriority: 0.7,
        suggestions: [],
        type: 'communication',
      },
    } as never);

    expect(result.success).toBe(false);
    expect(result.content).toContain('addPreferenceMemory with error detail');
    expect(addPreferenceMemory).not.toHaveBeenCalled();
  });

  describe('updateIdentityMemory', () => {
    const run = async (params: unknown) => {
      const updateIdentityMemory = vi
        .fn()
        .mockResolvedValue({ identityId: 'mem_1', message: 'updated', success: true });
      const runtime = new MemoryExecutionRuntime({
        service: createService({ updateIdentityMemory }),
      });
      const result = await runtime.updateIdentityMemory(params as UpdateIdentityMemoryParams);
      return { result, updateIdentityMemory };
    };

    // The manifest only requires `set.withIdentity`, so a partial update is valid.
    it('accepts a partial update that omits the optional fields', async () => {
      const { result, updateIdentityMemory } = await run({
        id: 'mem_1',
        mergeStrategy: 'merge',
        set: {
          withIdentity: {
            description: 'Senior platform engineer at Acme',
            extractedLabels: ['platform-engineer'],
            role: 'platform engineer',
          },
        },
      });

      expect(result.success).toBe(true);
      expect(updateIdentityMemory).toHaveBeenCalledWith({
        id: 'mem_1',
        mergeStrategy: 'merge',
        set: {
          withIdentity: {
            description: 'Senior platform engineer at Acme',
            extractedLabels: ['platform-engineer'],
            role: 'platform engineer',
          },
        },
      });
    });

    // The manifest says "use null for omitting the field": a null must leave the
    // stored value alone instead of being written over it.
    it('treats null fields as omitted rather than as values to store', async () => {
      const { result, updateIdentityMemory } = await run({
        id: 'mem_1',
        mergeStrategy: 'merge',
        set: {
          details: null,
          memoryCategory: null,
          memoryType: 'people',
          summary: null,
          tags: null,
          title: null,
          withIdentity: {
            description: 'Married on 2026-08-22',
            episodicDate: null,
            extractedLabels: ['spouse'],
            relationship: 'spouse',
            role: 'wife',
            scoreConfidence: 0.95,
            sourceEvidence: null,
            sourceIds: null,
            type: null,
          },
        },
      });

      expect(result.success).toBe(true);
      expect(updateIdentityMemory).toHaveBeenCalledWith({
        id: 'mem_1',
        mergeStrategy: 'merge',
        set: {
          memoryType: 'people',
          withIdentity: {
            description: 'Married on 2026-08-22',
            extractedLabels: ['spouse'],
            relationship: 'spouse',
            role: 'wife',
            scoreConfidence: 0.95,
          },
        },
      });
    });

    it('still rejects an update without withIdentity', async () => {
      const { result, updateIdentityMemory } = await run({
        id: 'mem_1',
        mergeStrategy: 'merge',
        set: { description: 'flattened by mistake' },
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('withIdentity');
      expect(updateIdentityMemory).not.toHaveBeenCalled();
    });
  });
});
