/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActionsBarConfig } from './useActionsBarConfig';

const agentState = vi.hoisted(() => ({ isHeterogeneous: false }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: (state: typeof agentState) => state.isHeterogeneous,
  },
}));

describe('useActionsBarConfig', () => {
  beforeEach(() => {
    agentState.isHeterogeneous = false;
  });

  it('keeps the ordinary-agent defaults', () => {
    const { result } = renderHook(() => useActionsBarConfig());

    expect(result.current).toEqual({});
  });

  it('omits delete from every heterogeneous-agent message menu', () => {
    agentState.isHeterogeneous = true;
    const { result } = renderHook(() => useActionsBarConfig());

    expect(result.current.user?.menu).not.toContain('del');
    expect(result.current.assistant?.menu).not.toContain('del');
    expect(result.current.assistantGroup?.menu).not.toContain('del');
  });
});
