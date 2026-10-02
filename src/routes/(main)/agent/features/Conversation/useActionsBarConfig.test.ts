import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActionsBarConfig } from './useActionsBarConfig';

const agent = vi.hoisted(() => ({ provider: 'codex' as string | undefined }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentHeterogeneousProviderType: () => agent.provider,
    isCurrentAgentHeterogeneous: () => !!agent.provider,
  },
}));

/** @example Codex user actions resolve Edit in both the bar and overflow menu. */
describe('Codex user message actions', () => {
  beforeEach(() => {
    agent.provider = 'codex';
  });

  /** @example A historical Codex prompt can be edited without hiding existing actions. */
  it('exposes Edit in both surfaces while retaining existing user actions', () => {
    // ROOT CAUSE:
    //
    // Heterogeneous slots replace UserActionsBar defaults rather than extending them.
    // The fixed copy-only slots hid the already registered Edit action.
    // Codex must include Edit explicitly in both surfaces.
    const { result } = renderHook(() => useActionsBarConfig());

    /** @example Both visible entry points resolve the registered edit action. */
    expect(result.current.user?.bar).toContain('edit');
    /** @example Overflow keeps Edit and the previously available operations exactly once. */
    expect(result.current.user?.menu).toEqual([
      'edit',
      'restoreToInput',
      'copy',
      'divider',
      'select',
      'divider',
      'del',
    ]);
    /** @example Editing a prompt does not expose assistant regeneration or branching. */
    expect(result.current.assistant?.bar).toEqual(['copy']);
  });

  /** @example Claude Code retains its existing menu while native agents use defaults. */
  it('keeps other runtimes on their existing action configuration', () => {
    agent.provider = 'claude-code';
    const { result, rerender } = renderHook(() => useActionsBarConfig());
    /** @example The Codex edit path does not opt Claude Code into edit semantics. */
    expect(result.current.user?.bar).toEqual(['copy']);

    agent.provider = undefined;
    rerender();
    /** @example Native agent defaults continue to supply their actions. */
    expect(result.current).toEqual({});
  });
});
