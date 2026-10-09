import { cleanup, renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { useActionsBarConfig } from './useActionsBarConfig';

const initialState = useAgentStore.getState();

/** @example A completed Codex reply exposes the existing regenerate action. */
describe('useActionsBarConfig', () => {
  beforeEach(() => {
    useAgentStore.setState({
      activeAgentId: 'codex-agent',
      agentMap: {
        'codex-agent': { agencyConfig: { heterogeneousProvider: { type: 'codex' } } },
      },
    });
  });

  afterEach(() => {
    cleanup();
    useAgentStore.setState(initialState, true);
  });

  // ROOT CAUSE:
  //
  // Completed Codex replies used the fixed HETERO_ASSISTANT slots, which only
  // exposed copy/select/delete even though regenerateAssistantMessage already
  // dispatched to the heterogeneous runtime. Both assistant shapes must expose
  // regenerate; tool-using turns render as assistantGroup.
  /** @example Both a text reply and a tool-using reply can be regenerated. */
  it('exposes regenerate for Codex assistant messages and groups', () => {
    const { result } = renderHook(() => useActionsBarConfig());

    /** @example A text reply offers regenerate in its quick actions. */
    expect(result.current.assistant?.bar).toContain('regenerate');
    /** @example Its overflow menu also offers regenerate. */
    expect(result.current.assistant?.menu).toContain('regenerate');
    /** @example Tool-using reply groups have the same lifecycle actions. */
    expect(result.current.assistantGroup).toEqual(result.current.assistant);
  });

  /** @example Restoring the user prompt remains available after enabling reply regeneration. */
  it('preserves the Codex user message actions', () => {
    const { result } = renderHook(() => useActionsBarConfig());

    /** @example The user menu still supports restoring the original prompt. */
    expect(result.current.user?.menu).toContain('restoreToInput');
    /** @example Edit and copy remain available together. */
    expect(result.current.user?.bar).toEqual(['copy']);
    /** @example Fork is available through overflow. */
    expect(result.current.user?.menu).toEqual(expect.arrayContaining(['branching']));
  });

  /** @example Switching from Codex to Claude Code removes the Codex-only action. */
  it('updates the slots when the heterogeneous provider changes', () => {
    const { result } = renderHook(() => useActionsBarConfig());

    act(() => {
      useAgentStore.setState({
        agentMap: {
          'codex-agent': { agencyConfig: { heterogeneousProvider: { type: 'claude-code' } } },
        },
      });
    });

    /** @example Claude Code keeps its current quick actions. */
    expect(result.current.assistant?.bar).toEqual(['copy']);
    /** @example Claude Code keeps its current overflow menu. */
    expect(result.current.assistant?.menu).toEqual(['copy', 'divider', 'select', 'divider', 'del']);
  });

  /** @example A native agent keeps the default actions provided by the message components. */
  it('uses the native defaults for agents without a heterogeneous provider', () => {
    useAgentStore.setState({ agentMap: { 'codex-agent': {} } });
    const { result } = renderHook(() => useActionsBarConfig());

    /** @example No overrides replace the native default action slots. */
    expect(result.current).toEqual({});
  });
});
