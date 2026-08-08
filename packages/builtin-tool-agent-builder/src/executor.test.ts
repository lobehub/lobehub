import type { ToolAfterCallContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentBuilderExecutor } from './executor';
import { AgentBuilderApiName, AgentBuilderIdentifier } from './types';

const {
  mockAppendStreamingSystemRole,
  mockFinishStreamingSystemRole,
  mockRefreshAgentConfig,
  mockStartStreamingSystemRole,
  mockUpdateAgentConfig,
} = vi.hoisted(() => ({
  mockAppendStreamingSystemRole: vi.fn(),
  mockFinishStreamingSystemRole: vi.fn(),
  mockRefreshAgentConfig: vi.fn().mockResolvedValue(undefined),
  mockStartStreamingSystemRole: vi.fn(),
  mockUpdateAgentConfig: vi.fn(),
}));

vi.mock('@lobechat/agent-manager-runtime', () => ({
  AgentManagerRuntime: vi.fn(() => ({ updateAgentConfig: mockUpdateAgentConfig })),
}));

vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/discover', () => ({ discoverService: {} }));
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({
    appendStreamingSystemRole: mockAppendStreamingSystemRole,
    finishStreamingSystemRole: mockFinishStreamingSystemRole,
    internal_refreshAgentConfig: mockRefreshAgentConfig,
    startStreamingSystemRole: mockStartStreamingSystemRole,
  }),
}));

const createContext = (
  apiName: string,
  options: { agentId?: string; success?: boolean } = {},
): ToolAfterCallContext => ({
  apiName,
  identifier: AgentBuilderIdentifier,
  params: {},
  result: {
    content: '',
    state: options.agentId ? { agentId: options.agentId } : undefined,
    success: options.success ?? true,
  },
});

describe('AgentBuilderExecutor.updateConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAgentConfig.mockResolvedValue({ content: 'updated', success: true });
  });

  it('normalizes metadata nested under config for client-side execution', async () => {
    const params = {
      config: {
        meta: { avatar: '🤖', title: 'GitHub PR/Issue Manager' },
        model: 'gpt-4o',
      },
    } as unknown as Parameters<typeof agentBuilderExecutor.updateConfig>[0];

    await agentBuilderExecutor.updateConfig(params, {
      agentId: 'target-agent',
      messageId: 'message-1',
    });

    expect(mockUpdateAgentConfig).toHaveBeenCalledWith('target-agent', {
      config: { model: 'gpt-4o' },
      meta: { avatar: '🤖', title: 'GitHub PR/Issue Manager' },
    });
  });
});

describe('AgentBuilderExecutor.onAfterCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    AgentBuilderApiName.updateAgentConfig,
    AgentBuilderApiName.updatePrompt,
    AgentBuilderApiName.installPlugin,
  ])('refreshes the invocation-scoped target after %s', async (apiName) => {
    await agentBuilderExecutor.onAfterCall(createContext(apiName, { agentId: 'target-agent' }));

    expect(mockRefreshAgentConfig).toHaveBeenCalledExactlyOnceWith('target-agent');
  });

  it('does not replay a gateway prompt update through the persistent streaming actions', async () => {
    await agentBuilderExecutor.onAfterCall(
      createContext(AgentBuilderApiName.updatePrompt, { agentId: 'target-agent' }),
    );

    expect(mockStartStreamingSystemRole).not.toHaveBeenCalled();
    expect(mockAppendStreamingSystemRole).not.toHaveBeenCalled();
    expect(mockFinishStreamingSystemRole).not.toHaveBeenCalled();
  });

  it('does not fall back to mutable UI state when the result has no target', async () => {
    await agentBuilderExecutor.onAfterCall(createContext(AgentBuilderApiName.updatePrompt));

    expect(mockRefreshAgentConfig).not.toHaveBeenCalled();
  });

  it('does not refresh after a failed write', async () => {
    await agentBuilderExecutor.onAfterCall(
      createContext(AgentBuilderApiName.updatePrompt, {
        agentId: 'target-agent',
        success: false,
      }),
    );

    expect(mockRefreshAgentConfig).not.toHaveBeenCalled();
  });

  it('does not refresh after a read operation', async () => {
    await agentBuilderExecutor.onAfterCall(
      createContext(AgentBuilderApiName.getAvailableModels, { agentId: 'target-agent' }),
    );

    expect(mockRefreshAgentConfig).not.toHaveBeenCalled();
  });
});
