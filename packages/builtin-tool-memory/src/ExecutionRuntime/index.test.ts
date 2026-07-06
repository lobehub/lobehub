import { describe, expect, it, vi } from 'vitest';

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
});
