import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost, LLMTransport, MessageTransport, StreamSink } from '../transport';
import type { AgentInstructionCallLlm, AgentState } from '../types';
import { callLlm } from './callLlm';

const createState = (): AgentState => ({
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  messages: [],
  metadata: {
    agentId: 'agent-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls: 0,
      processingTimeMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
    },
    tools: {
      byTool: [],
      totalCalls: 0,
      totalTimeMs: 0,
    },
  },
});

const instruction: AgentInstructionCallLlm = {
  payload: {
    messages: [{ content: 'hello', role: 'user' }],
    model: 'gpt-4',
    provider: 'openai',
    tools: [],
  },
  type: 'call_llm',
};

const createMessageTransport = (): MessageTransport => ({
  createAssistantMessage: vi.fn().mockResolvedValue({ id: 'assistant-1' }),
  createToolMessage: vi.fn(),
  deleteMessage: vi.fn(),
  findById: vi.fn().mockResolvedValue({ id: 'parent-1' }),
  query: vi.fn(),
  update: vi.fn(),
  updatePluginState: vi.fn(),
  updateToolMessage: vi.fn(),
});

const createStreamSink = (): StreamSink => ({
  publishChunk: vi.fn(),
  publishEvent: vi.fn(),
});

const createHost = (
  llm: LLMTransport,
  messages = createMessageTransport(),
  stream = createStreamSink(),
): AgentRuntimeHost => ({
  operation: { operationId: 'op-1', stepIndex: 0 },
  transports: {
    llm,
    messages,
    stream,
  },
});

describe('callLlm executor', () => {
  it('prepares the assistant message and delegates call_llm execution to the LLM transport', async () => {
    const state = createState();
    const expected = {
      events: [],
      newState: state,
    };
    const executeCall = vi.fn().mockResolvedValue(expected);
    const messages = createMessageTransport();
    const stream = createStreamSink();
    const host = createHost(
      {
        executeCall,
        stream: vi.fn(),
      },
      messages,
      stream,
    );
    const instructionWithParent: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        parentId: 'parent-1',
      },
      type: 'call_llm',
    };

    await expect(callLlm(host)(instructionWithParent, state)).resolves.toBe(expected);
    expect(messages.findById).toHaveBeenCalledWith('parent-1');
    expect(messages.createAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        content: '',
        model: 'gpt-4',
        parentId: 'parent-1',
        provider: 'openai',
        role: 'assistant',
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    );
    expect(stream.publishEvent).toHaveBeenCalledWith({
      data: {
        assistantMessage: { id: 'assistant-1' },
        model: 'gpt-4',
        provider: 'openai',
      },
      stepIndex: 0,
      type: 'stream_start',
    });
    expect(executeCall).toHaveBeenCalledWith({
      assistantMessage: { id: 'assistant-1' },
      instruction: instructionWithParent,
      model: 'gpt-4',
      parentId: 'parent-1',
      provider: 'openai',
      state,
      stepLabel: undefined,
    });
  });

  it('reuses an existing assistant message without creating a new one', async () => {
    const state = createState();
    const expected = {
      events: [],
      newState: state,
    };
    const executeCall = vi.fn().mockResolvedValue(expected);
    const messages = createMessageTransport();
    const host = createHost(
      {
        executeCall,
        stream: vi.fn(),
      },
      messages,
    );
    const reuseInstruction: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        assistantMessageId: 'assistant-existing',
      },
      type: 'call_llm',
    };

    await expect(callLlm(host)(reuseInstruction, state)).resolves.toBe(expected);
    expect(messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(executeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessage: { id: 'assistant-existing' },
      }),
    );
  });

  it('throws when the LLM transport does not provide executeCall', async () => {
    const host = createHost({
      stream: vi.fn(),
    });

    await expect(callLlm(host)(instruction, createState())).rejects.toThrow(
      'LLMTransport.executeCall is required for call_llm executor',
    );
  });

  it('fails before creating an assistant message when the parent message is missing', async () => {
    const messages = createMessageTransport();
    vi.mocked(messages.findById).mockResolvedValue(undefined);
    const stream = createStreamSink();
    const host = createHost(
      {
        executeCall: vi.fn(),
        stream: vi.fn(),
      },
      messages,
      stream,
    );
    const instructionWithParent: AgentInstructionCallLlm = {
      payload: {
        ...instruction.payload,
        parentMessageId: 'missing-parent',
      },
      type: 'call_llm',
    };

    await expect(callLlm(host)(instructionWithParent, createState())).rejects.toMatchObject({
      errorType: 'ConversationParentMissing',
      parentId: 'missing-parent',
    });
    expect(messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(stream.publishEvent).toHaveBeenCalledWith({
      data: {
        error:
          'Conversation parent message missing-parent no longer exists. It was likely deleted while the operation was running.',
        errorType: 'ConversationParentMissing',
        phase: 'parent_message_preflight',
      },
      stepIndex: 0,
      type: 'error',
    });
  });
});
