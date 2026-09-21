// @vitest-environment node
import { ModelRuntime } from '@lobechat/model-runtime';
import { tracer as agentRuntimeTracer } from '@lobechat/observability-otel/modules/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('ServerLLMTransport.stream · conversation affinity', () => {
  it('retains the conversation ID across compression requests and runtime recreation', async () => {
    const chat = vi.fn().mockImplementation(async () => new Response(''));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      const ctx = { topicId, userId: 'user-1' } as RuntimeExecutorContext;
      await new ServerLLMTransport(ctx).stream({
        messages: [],
        model: 'glm-5',
        provider: 'opencodecodingplan',
      });
    }

    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.map(([, options]) => options.metadata.topicId)).toEqual([
      'topic-1',
      'topic-1',
      'topic-2',
    ]);
  });
});

describe('ServerLLMTransport.createTrace · streaming mode', () => {
  it('records the streaming mode the built context resolved, not the operation default', () => {
    const startSpan = vi.spyOn(agentRuntimeTracer, 'startSpan');
    const ctx = { operationId: 'op-1', stepIndex: 0, userId: 'user-1' } as RuntimeExecutorContext;

    new ServerLLMTransport(ctx).createTrace({
      assistantMessageId: 'msg-1',
      context: {
        messages: [],
        modelParameters: { stream: false },
        replayAssistantReasoning: false,
      },
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(startSpan).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        attributes: expect.objectContaining({ 'gen_ai.request.stream': false }),
      }),
    );

    // An explicit operation-level stream is already folded into the context;
    // without any context the operation value still applies.
    new ServerLLMTransport({ ...ctx, stream: false }).createTrace({
      assistantMessageId: 'msg-2',
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(startSpan).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        attributes: expect.objectContaining({ 'gen_ai.request.stream': false }),
      }),
    );
  });
});
