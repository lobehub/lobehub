import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

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

// User skills share the list's default glyph, regardless of their source.
describe('useUserSkills', () => {
  const initialState = useAgentStore.getState();

  beforeEach(() => {
    act(() =>
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        agentMap: { 'agent-a': { plugins: skills.map((skill) => skill.identifier) } },
      }),
    );
  });

  afterEach(() => {
    act(() => useAgentStore.setState(initialState));
  });

  it('shows only the current agent’s enabled skills and updates when switching agents', () => {
    act(() =>
      useAgentStore.setState({
        agentMap: {
          'agent-a': {
            plugins: [
              { identifier: skills[0].identifier, mode: 'disabled' },
              { identifier: skills[1].identifier, mode: 'auto' },
              'unrelated-mcp',
            ],
          },
          'agent-b': { plugins: [{ identifier: skills[0].identifier, mode: 'pinned' }] },
        },
      }),
    );
    const { result } = renderHook(() => useUserSkills());

    expect(result.current.map((skill) => skill.id)).toEqual([skills[1].identifier]);

    act(() => useAgentStore.setState({ activeAgentId: 'agent-b' }));
    expect(result.current.map((skill) => skill.id)).toEqual([skills[0].identifier]);

    act(() => useAgentStore.setState({ activeAgentId: 'not-loaded' }));
    expect(result.current).toEqual([]);
  });

  it('keeps the full inventory available for management when every skill is disabled', () => {
    act(() => useAgentStore.setState({ agentMap: { 'agent-a': { plugins: [] } } }));
    const { result } = renderHook(() => useUserSkills(true, true));
    expect(result.current.map((skill) => skill.id)).toEqual(
      skills.map((skill) => skill.identifier),
    );
  });

  it('uses the shared skill glyph for market skills without changing their identity', () => {
    const { result } = renderHook(() => useUserSkills());

    expect(result.current[0]).toMatchObject({
      description: skills[0].description,
      id: skills[0].identifier,
      name: skills[0].name,
    });
    expect(result.current[0]).not.toHaveProperty('icon');
  });

  it('uses the same shared skill glyph for custom skills', () => {
    const { result } = renderHook(() => useUserSkills());

    expect(result.current[1]).not.toHaveProperty('icon');
  });

  it('does not produce rows or icons when the section is disabled', () => {
    const { result } = renderHook(() => useUserSkills(false));

    expect(result.current).toEqual([]);
  });
});
