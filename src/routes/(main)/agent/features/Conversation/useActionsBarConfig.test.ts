import type * as LobechatConst from '@lobechat/const';
import { cleanup, renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { useActionsBarConfig } from './useActionsBarConfig';

const runtime = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConst>()),
  get isDesktop() {
    return runtime.isDesktop;
  },
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: useAgentStore((s) =>
      s.activeAgentId ? s.agentMap[s.activeAgentId]?.agencyConfig : undefined,
    ),
    isPreferenceLoading: false,
    workspaceScoped: false,
  }),
}));

const initialState = useAgentStore.getState();

/** @example A completed Codex reply exposes the existing regenerate action. */
describe('useActionsBarConfig', () => {
  beforeEach(() => {
    runtime.isDesktop = true;
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
    /** @example User edits and the existing copy action are both available. */
    expect(result.current.user?.bar).toEqual(['edit', 'copy']);
    /** @example Historical user prompts also expose Edit in the overflow menu. */
    expect(result.current.user?.menu).toContain('edit');
  });

  /** @example Only executable local or bound-device targets advertise Edit. */
  it('offers device Edit while keeping unbound Web and sandbox unavailable', () => {
    // ROOT CAUSE:
    // Provider-only slots originally advertised Edit even when gateway editing
    // was unsupported. The device dispatch now hydrates durable edit context;
    // unbound Web and sandbox still have no supported edit execution target.
    const { result, rerender } = renderHook(() => useActionsBarConfig());
    runtime.isDesktop = false;
    rerender();
    /** @example Web never advertises an in-process edit operation. */
    expect(result.current.user?.menu).not.toContain('edit');
    runtime.isDesktop = true;
    for (const executionTarget of ['sandbox', 'device'] as const) {
      act(() =>
        useAgentStore.setState({
          agentMap: {
            'codex-agent': {
              agencyConfig: {
                executionTarget,
                boundDeviceId: 'remote',
                heterogeneousProvider: { type: 'codex' },
              },
            },
          },
        }),
      );
      rerender();
      /** @example A bound device can edit; sandbox keeps its existing copy action. */
      expect(result.current.user?.bar).toEqual(
        executionTarget === 'device' ? ['edit', 'copy'] : ['copy'],
      );
    }
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
