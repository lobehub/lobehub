import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeModelSwitch } from './useHomeModelSwitch';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: { 'agent-1': {} } as Record<string, object>,
    enableAgentMode: false,
    updateAgentConfigById: vi.fn(),
  },
  modeConfig: {} as { chatConfig?: { enableAgentMode?: boolean } },
  selection: {
    canDisplayModel: true,
    canSelectModel: true,
    model: 'shared-model',
    provider: 'lobehub',
    selectModel: vi.fn(),
    selectionLockReason: undefined as 'fixedByAgent' | 'useOnly' | undefined,
    usesWorkspaceMemberSelection: false,
  },
}));

vi.mock('@/business/client/hooks/useBusinessAgentMode', () => ({
  useBusinessModelModeConfig: () => (config: object) => ({ ...config, ...testState.modeConfig }),
}));

vi.mock('@/features/ChatInput/hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => testState.selection,
}));

vi.mock('@/store/agent', () => {
  const useAgentStore = (selector: (s: typeof testState.agent) => unknown) =>
    selector(testState.agent);
  useAgentStore.getState = () => testState.agent;
  return { useAgentStore };
});

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentEnableModeById: () => (s: typeof testState.agent) => s.enableAgentMode,
  },
}));

const target = { model: 'minimax-m3.1-flash', provider: 'lobehub' };

describe('useHomeModelSwitch', () => {
  beforeEach(() => {
    testState.agent.agentMap = { 'agent-1': {} };
    testState.agent.enableAgentMode = false;
    testState.agent.updateAgentConfigById = vi.fn();
    testState.modeConfig = {};
    testState.selection = {
      canDisplayModel: true,
      canSelectModel: true,
      model: 'shared-model',
      provider: 'lobehub',
      selectModel: vi.fn().mockResolvedValue(true),
      selectionLockReason: undefined,
      usesWorkspaceMemberSelection: false,
    };
  });

  it('reads and writes the member override on a shared Workspace Agent', async () => {
    // The Workspace Inbox: the input trigger shows the member's own pick, not
    // the Agent row's model.
    testState.selection.model = 'gemini-4-argon';
    testState.selection.usesWorkspaceMemberSelection = true;

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));
    expect(result.current.model).toBe('gemini-4-argon');

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.switchModel(target);
    });

    expect(outcome).toBe('switched');
    expect(testState.selection.selectModel).toHaveBeenCalledWith(target, {
      rethrow: true,
      showErrorMessage: false,
    });
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('reports the model in use against the member override', async () => {
    testState.selection.model = target.model;
    testState.selection.usesWorkspaceMemberSelection = true;
    // Leaving Agent mode never applies to a member override.
    testState.modeConfig = { chatConfig: { enableAgentMode: false } };
    testState.agent.enableAgentMode = true;

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    await expect(result.current.switchModel(target)).resolves.toBe('inUse');
    expect(testState.selection.selectModel).not.toHaveBeenCalled();
  });

  it('still switches the Agent row out of Agent mode for the same model', async () => {
    testState.selection.model = target.model;
    testState.modeConfig = { chatConfig: { enableAgentMode: false } };
    testState.agent.enableAgentMode = true;

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    await expect(result.current.switchModel(target)).resolves.toBe('switched');
  });

  it('waits for the Agent config before switching', async () => {
    testState.agent.agentMap = {};

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    expect(result.current.isReady).toBe(false);
    await expect(result.current.switchModel(target)).resolves.toBe('loading');
    expect(testState.selection.selectModel).not.toHaveBeenCalled();
  });

  it('waits for access and the member preference before switching', async () => {
    testState.selection.canDisplayModel = false;
    testState.selection.canSelectModel = false;

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    expect(result.current.isReady).toBe(false);
    await expect(result.current.switchModel(target)).resolves.toBe('loading');
    expect(testState.selection.selectModel).not.toHaveBeenCalled();
  });

  it('reports a locked model with the reason the input trigger shows', async () => {
    testState.selection.canSelectModel = false;
    testState.selection.selectionLockReason = 'fixedByAgent';

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    expect(result.current.lockTip).toBe('chat:input.modelFixedTip');
    await expect(result.current.switchModel(target)).resolves.toBe('locked');
    expect(testState.selection.selectModel).not.toHaveBeenCalled();
  });

  it('reports a rejected write as failed', async () => {
    testState.selection.selectModel = vi.fn().mockRejectedValue(new Error('denied'));

    const { result } = renderHook(() => useHomeModelSwitch('agent-1'));

    await expect(result.current.switchModel(target)).resolves.toBe('failed');
  });
});
