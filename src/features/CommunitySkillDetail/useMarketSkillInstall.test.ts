// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';

import { useMarketSkillInstall } from './useMarketSkillInstall';

const state = vi.hoisted(() => ({
  agentSkillListMap: { all: [] as { id: string; identifier: string }[] },
  refreshAgentSkills: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('@/store/tool/selectors', () => import('@/store/tool/slices/agentSkills/selectors'));
vi.mock('@/services/skill', () => ({ agentSkillService: { importFromMarket: vi.fn() } }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

it('uses the newly installed library record for management and prevents a second install', async () => {
  state.refreshAgentSkills.mockImplementationOnce(() => {
    state.agentSkillListMap.all = [{ id: 'library-id', identifier: 'market-name' }];
  });

  const { rerender, result } = renderHook(() => useMarketSkillInstall('market-name'));
  expect(result.current.installedSkillId).toBeUndefined();
  await act(() => result.current.install());

  rerender();
  expect(result.current.installedSkillId).toBe('library-id');
  await act(() => result.current.install());
  expect(agentSkillService.importFromMarket).toHaveBeenCalledTimes(1);
});
