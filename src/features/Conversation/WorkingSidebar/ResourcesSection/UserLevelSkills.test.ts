import { renderHook } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUserSkills } from './UserLevelSkills';

const { skills, useFetchAgentSkills } = vi.hoisted(() => ({
  skills: [
    {
      description: 'Analyze spreadsheets',
      identifier: 'davila7-claude-code-templates-excel-analysis',
      name: 'Excel Analysis',
      source: 'market',
    },
    {
      description: 'A locally authored skill',
      identifier: 'my-skill',
      name: 'My skill',
      source: 'user',
    },
  ],
  useFetchAgentSkills: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: unknown) => unknown) =>
    selector({ skills, useFetchAgentSkills }),
}));

vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: { getAgentSkills: (state: { skills: typeof skills }) => state.skills },
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/SkillsList', () => ({}));
vi.mock('@/features/ChatInput/InputEditor/ActionTag/skillDragData', () => ({
  startSkillDrag: vi.fn(),
}));

// Exercise the sidebar's row data, not a component render. The icon's own
// market lookup remains shared with the input menu.
describe('useUserSkills icons', () => {
  it('provides a market icon for installed market skills without changing their identity', () => {
    const { result } = renderHook(() => useUserSkills());

    expect(result.current[0]).toMatchObject({
      description: skills[0].description,
      id: skills[0].identifier,
      name: skills[0].name,
    });
    expect(result.current[0]).toHaveProperty('icon', expect.anything());
    expect(isValidElement(result.current[0].icon)).toBe(true);
  });

  it('keeps the generic skill icon fallback for custom skills', () => {
    const { result } = renderHook(() => useUserSkills());

    expect(result.current[1].icon).toBeUndefined();
  });

  it('does not produce rows or icons when the section is disabled', () => {
    const { result } = renderHook(() => useUserSkills(false));

    expect(result.current).toEqual([]);
  });
});
