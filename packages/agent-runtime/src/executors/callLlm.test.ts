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
  createAssistantMessage: vi.fn(),
  createToolMessage: vi.fn(),
  deleteMessage: vi.fn(),
  findById: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  updatePluginState: vi.fn(),
  updateToolMessage: vi.fn(),
});

const createStreamSink = (): StreamSink => ({
  publishChunk: vi.fn(),
  publishEvent: vi.fn(),
});

const createHost = (llm: LLMTransport): AgentRuntimeHost => ({
  operation: { operationId: 'op-1', stepIndex: 0 },
  transports: {
    llm,
    messages: createMessageTransport(),
    stream: createStreamSink(),
  },
});

describe('callLlm executor', () => {
  it('delegates call_llm execution to the LLM transport', async () => {
    const state = createState();
    const expected = {
      events: [],
      newState: state,
    };
    const executeCall = vi.fn().mockResolvedValue(expected);
    const host = createHost({
      executeCall,
      stream: vi.fn(),
    });

    await expect(callLlm(host)(instruction, state)).resolves.toBe(expected);
    expect(executeCall).toHaveBeenCalledWith({ instruction, state });
  });

  it('throws when the LLM transport does not provide executeCall', async () => {
    const host = createHost({
      stream: vi.fn(),
    });

    await expect(callLlm(host)(instruction, createState())).rejects.toThrow(
      'LLMTransport.executeCall is required for call_llm executor',
    );
  });
});
