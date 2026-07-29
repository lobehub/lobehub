import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import type * as SwrLib from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService } from '@/services/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';
import { LayersEnum } from '@/types/userMemory';

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrLib>();

  return {
    ...actual,
    mutate: vi.fn().mockResolvedValue(undefined),
  };
});

const preferenceMemory = {
  accessedAt: new Date('2026-05-27T00:00:00.000Z'),
  capturedAt: new Date('2026-05-27T00:00:00.000Z'),
  conclusionDirectives: 'Prefer concise answers.',
  createdAt: new Date('2026-05-27T00:00:00.000Z'),
  id: 'preference-1',
  metadata: null,
  scorePriority: 0,
  suggestions: null,
  tags: [],
  title: 'Preference',
  type: null,
  updatedAt: new Date('2026-05-27T00:00:00.000Z'),
  userId: 'user-1',
  userMemoryId: 'memory-1',
} satisfies DisplayPreferenceMemory;

beforeEach(() => {
  vi.clearAllMocks();

  useUserMemoryStore.setState(
    {
      ...initialState,
      preferences: [preferenceMemory],
      preferencesInit: true,
      preferencesPage: 1,
      preferencesSearchLoading: false,
      preferencesTotal: 1,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('userMemory base actions', () => {
  describe('updateMemory', () => {
    it('updates a preference memory in place and revalidates related caches', async () => {
      const updatePreferenceResult = {} as Awaited<
        ReturnType<typeof memoryCRUDService.updatePreference>
      >;
      vi.spyOn(memoryCRUDService, 'updatePreference').mockResolvedValue(updatePreferenceResult);

      const { result } = renderHook(() => useUserMemoryStore());

      await act(async () => {
        await result.current.updateMemory(
          'preference-1',
          'Prefer concise answers with examples.',
          LayersEnum.Preference,
        );
      });

      expect(result.current.preferences).toEqual([
        {
          ...preferenceMemory,
          conclusionDirectives: 'Prefer concise answers with examples.',
        },
      ]);
      expect(result.current.preferencesSearchLoading).toBe(false);
      expect(memoryCRUDService.updatePreference).toHaveBeenCalledWith('preference-1', {
        conclusionDirectives: 'Prefer concise answers with examples.',
      });
      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
      expect(mutate).toHaveBeenCalledWith(
        userMemoryKeys.memoryDetail(LayersEnum.Preference, 'preference-1'),
      );
    });
  });
});
