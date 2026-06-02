// @vitest-environment node
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { TraceNameMap } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTraceOptions } from './trace';

const traceMocks = vi.hoisted(() => {
  const generation = vi.fn(() => ({ id: 'generation-id', update: vi.fn() }));
  const createTrace = vi.fn(() => ({ generation, id: 'trace-id', update: vi.fn() }));

  return { createTrace, generation };
});

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(() => ({
    createTrace: traceMocks.createTrace,
    shutdownAsync: vi.fn(),
  })),
}));

describe('createTraceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should only pass Langfuse-compatible values as generation modelParameters', () => {
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      model: 'GLM-5',
      reasoning: { effort: 'medium', summary: 'auto' },
      response_format: { type: 'json_object' },
      stream: true,
      temperature: 0.7,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tool_choice: 'auto',
    } as ChatStreamPayload;

    createTraceOptions(payload, {
      provider: 'newapi',
      trace: { enabled: true, traceName: TraceNameMap.Conversation },
    });

    expect(traceMocks.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelParameters: {
          reasoning: JSON.stringify({ effort: 'medium', summary: 'auto' }),
          response_format: JSON.stringify({ type: 'json_object' }),
          stream: true,
          temperature: 0.7,
          thinking: JSON.stringify({ budget_tokens: 1024, type: 'enabled' }),
          tool_choice: 'auto',
        },
      }),
    );
  });

  it('should preserve array parameters and omit nullish parameters', () => {
    const payload = {
      messages: [{ content: 'hello', role: 'user' }],
      mockChunks: ['hello', { type: 'text' }],
      model: 'test-model',
      n: null,
      provider: undefined,
    } as unknown as ChatStreamPayload;

    createTraceOptions(payload, {
      provider: 'mock',
      trace: { enabled: true, traceName: TraceNameMap.Conversation },
    });

    expect(traceMocks.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelParameters: {
          mockChunks: ['hello', JSON.stringify({ type: 'text' })],
        },
      }),
    );
  });
});
