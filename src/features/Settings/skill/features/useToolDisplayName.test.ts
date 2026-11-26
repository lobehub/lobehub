import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToolDisplayName } from './useToolDisplayName';

const mocks = vi.hoisted(() => ({
  state: {
    agentSkillDetailMap: {} as Record<string, { skillDetail: { name: string } }>,
    agentSkillListMap: { all: [] as Array<{ id: string; identifier: string; name: string }> },
    builtinSkills: [] as Array<{ identifier: string; name: string }>,
    builtinTools: [],
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options: { defaultValue: string }) =>
      key === 'tools.builtins.lobe-agent-browser.title' ? '助手浏览器' : options.defaultValue,
  }),
}));

describe('skill detail breadcrumb names', () => {
  beforeEach(() => {
    mocks.state.agentSkillListMap.all = [];
    mocks.state.agentSkillDetailMap = {};
    mocks.state.builtinSkills = [];
  });

  it('looks up installed skills by id, not their import identifier', () => {
    mocks.state.agentSkillListMap.all = [
      { id: 'first', identifier: 'skl-selected', name: 'Other skill' },
      { id: 'skl-selected', identifier: 'imported-skill', name: 'Imported skill' },
    ];
    expect(renderHook(() => useToolDisplayName('skl-selected', 'agent-skill')).result.current).toBe(
      'Imported skill',
    );
  });

  it('uses a loaded detail name when opening a deep link without a loaded list', () => {
    mocks.state.agentSkillDetailMap['skl-detail'] = { skillDetail: { name: 'Deep-linked skill' } };
    expect(renderHook(() => useToolDisplayName('skl-detail', 'agent-skill')).result.current).toBe(
      'Deep-linked skill',
    );
  });

  it('uses the localized builtin name, falling back to the manifest name', () => {
    mocks.state.builtinSkills = [
      { identifier: 'lobe-agent-browser', name: 'Agent Browser' },
      { identifier: 'custom-builtin', name: 'Custom builtin' },
    ];
    expect(
      renderHook(() => useToolDisplayName('lobe-agent-browser', 'builtin-skill')).result.current,
    ).toBe('助手浏览器');
    expect(
      renderHook(() => useToolDisplayName('custom-builtin', 'builtin-skill')).result.current,
    ).toBe('Custom builtin');
  });
});
