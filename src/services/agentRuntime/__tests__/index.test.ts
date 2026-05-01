import { type UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuntimeService } from '../index';

const {
  contextEngineeringMock,
  createOperationMutateMock,
  createAgentToolsEngineMock,
  getAgentStoreStateMock,
  isCanUseVideoMock,
  isCanUseVisionMock,
} = vi.hoisted(() => ({
  contextEngineeringMock: vi.fn(),
  createAgentToolsEngineMock: vi.fn(),
  createOperationMutateMock: vi.fn(),
  getAgentStoreStateMock: vi.fn(),
  isCanUseVideoMock: vi.fn(),
  isCanUseVisionMock: vi.fn(),
}));

vi.mock('@/helpers/toolEngineering', () => ({
  createAgentToolsEngine: createAgentToolsEngineMock,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      createOperation: {
        mutate: createOperationMutateMock,
      },
      getOperationStatus: {
        query: vi.fn(),
      },
      processHumanIntervention: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('@/services/chat/mecha', () => ({
  contextEngineering: contextEngineeringMock,
}));

vi.mock('@/services/chat/helper', () => ({
  isCanUseVideo: isCanUseVideoMock,
  isCanUseVision: isCanUseVisionMock,
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: getAgentStoreStateMock,
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: vi.fn(() => ({ inputTemplate: 'input-template' })),
    enableHistoryCount: vi.fn(() => true),
    historyCount: vi.fn(() => 3),
    isAgentEnableSearch: vi.fn(() => false),
  },
  agentSelectors: {
    currentAgentConfig: vi.fn(() => ({
      model: 'gpt-4o',
      plugins: ['plugin-1'],
      provider: 'openai',
      systemRole: 'system-role',
    })),
    getAgentDocumentsById: vi.fn(() => () => undefined),
  },
}));

describe('AgentRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createAgentToolsEngineMock.mockReturnValue({
      generateToolsDetailed: vi.fn(() => ({
        enabledToolIds: ['plugin-1'],
        tools: [{ function: { name: 'plugin-1____api-1' }, type: 'function' }],
      })),
      getEnabledPluginManifests: vi.fn(() => new Map([['plugin-1', { identifier: 'plugin-1' }]])),
    });

    contextEngineeringMock.mockResolvedValue([{ content: 'compiled', role: 'system' }]);
    createOperationMutateMock.mockResolvedValue({ operationId: 'op-1' });
    isCanUseVideoMock.mockReturnValue(true);
    isCanUseVisionMock.mockReturnValue(true);
    Object.defineProperty(window, 'global_serverConfigStore', {
      configurable: true,
      value: {
        getState: () => ({ serverConfig: { enableVisualUnderstanding: true } }),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'global_serverConfigStore');
  });

  it('should keep agent documents optional when hydration returns undefined', async () => {
    const ensureAgentDocuments = vi.fn().mockResolvedValue(undefined);

    getAgentStoreStateMock.mockReturnValue({
      activeAgentId: 'agent-1',
      ensureAgentDocuments,
    });

    const messages = [{ content: 'Hello', role: 'user' }] as UIChatMessage[];

    await agentRuntimeService.createOperation({
      messages,
      userMessageId: 'msg-1',
    });

    expect(ensureAgentDocuments).toHaveBeenCalledWith('agent-1');
    expect(contextEngineeringMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocuments: undefined,
      }),
    );
    expect(createOperationMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ content: 'compiled', role: 'system' }],
      }),
    );
  });

  it('should opt into visual understanding for image messages when the model cannot see images', async () => {
    isCanUseVisionMock.mockReturnValue(false);
    getAgentStoreStateMock.mockReturnValue({
      activeAgentId: 'agent-1',
    });

    await agentRuntimeService.createOperation({
      messages: [{ id: 'msg-1', imageList: [{ id: 'file-1' }], role: 'user' }] as UIChatMessage[],
      userMessageId: 'msg-1',
    });

    expect(createAgentToolsEngineMock).toHaveBeenCalledWith(
      { model: 'gpt-4o', provider: 'openai' },
      ['plugin-1', 'lobe-agent'],
    );
  });

  it('should not opt into visual understanding when the current message has no visual attachments', async () => {
    isCanUseVisionMock.mockReturnValue(false);
    isCanUseVideoMock.mockReturnValue(false);
    getAgentStoreStateMock.mockReturnValue({
      activeAgentId: 'agent-1',
    });

    await agentRuntimeService.createOperation({
      messages: [{ id: 'msg-1', content: 'Hello', role: 'user' }] as UIChatMessage[],
      userMessageId: 'msg-1',
    });

    expect(createAgentToolsEngineMock).toHaveBeenCalledWith(
      { model: 'gpt-4o', provider: 'openai' },
      ['plugin-1'],
    );
  });
});
