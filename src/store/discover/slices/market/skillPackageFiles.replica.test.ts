/**
 * @vitest-environment happy-dom
 *
 * An uninstalled Market skill's package files are a replica persisted to
 * IndexedDB, so a reopened Skill Store detail paints its file tree without
 * waiting for the zip download again; an installed skill never downloads it.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import {
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';
import { marketSelectors } from '@/store/discover/selectors';

const usePackageFiles = (enabled: boolean) => {
  const { queryKey } = useDiscoverStore((s) => s.useSkillPackageFiles)('pdf-tools', enabled);
  return useDiscoverStore(marketSelectors.skillPackageFiles(queryKey));
};

describe('skill package files replica', () => {
  const { persist } = useReplicaHarness('skill-files');

  it('paints the persisted files before the download finishes', async () => {
    await persist('discoverSkillPackageFiles', 'pdf-tools', [
      { content: 'print("hi")', path: 'scripts/run.py' },
    ]);
    vi.spyOn(marketApiService, 'getSkillPackageFiles').mockImplementation(pending);

    const { result } = renderHook(() => usePackageFiles(true), { wrapper });

    await waitFor(() => expect(result.current?.[0]?.path).toBe('scripts/run.py'));
  });

  it('does not download the package of an installed skill', async () => {
    const download = vi.spyOn(marketApiService, 'getSkillPackageFiles');

    const { result } = renderHook(() => usePackageFiles(false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeUndefined();
    expect(download).not.toHaveBeenCalled();
  });
});
