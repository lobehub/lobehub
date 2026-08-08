import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import { SkillSorts } from '@/types/discover';

import { useDiscoverStore as useStore } from '../../store';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
});

const listItem = (identifier: string) => ({ identifier, name: identifier }) as any;

describe('SkillAction', () => {
  describe('useFetchRelatedSkills', () => {
    it('fetches same-category recommended skills, dropping the skill itself and capping at 6', async () => {
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
      vi.spyOn(discoverService, 'getSkillList').mockResolvedValue({
        items: [
          listItem('github.acme.skill-a'),
          ...Array.from({ length: 6 }, (_, i) => listItem(`github.acme.other-${i}`)),
        ],
      } as any);

      const { result } = renderHook(() =>
        useStore.getState().useFetchRelatedSkills({
          category: 'productivity-tasks',
          identifier: 'github.acme.skill-a',
        }),
      );

      await waitFor(() => {
        expect(result.current.data).toHaveLength(6);
      });

      expect(discoverService.getSkillList).toHaveBeenCalledWith({
        category: 'productivity-tasks',
        page: 1,
        pageSize: 7,
        sort: SkillSorts.Recommended,
      });
      expect(result.current.data?.map((i) => i.identifier)).not.toContain('github.acme.skill-a');
    });

    it('caps at 6 even when the skill itself is not in the page', async () => {
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
      vi.spyOn(discoverService, 'getSkillList').mockResolvedValue({
        items: Array.from({ length: 7 }, (_, i) => listItem(`github.acme.other-${i}`)),
      } as any);

      const { result } = renderHook(() =>
        useStore.getState().useFetchRelatedSkills({
          category: 'productivity-tasks',
          identifier: 'github.acme.skill-a',
        }),
      );

      await waitFor(() => {
        expect(result.current.data).toHaveLength(6);
      });
    });

    it('does not fetch without a category', async () => {
      const getSkillList = vi.spyOn(discoverService, 'getSkillList');

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({ identifier: 'github.acme.skill-a' }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(getSkillList).not.toHaveBeenCalled();
    });

    it('does not fetch without an identifier', async () => {
      const getSkillList = vi.spyOn(discoverService, 'getSkillList');

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({ category: 'productivity-tasks' }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(getSkillList).not.toHaveBeenCalled();
    });
  });
});
