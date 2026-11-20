import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { oneShotRelay } from '@/services/llmRelay';

import { aiChatService } from './aiChat';
import { followUpActionService } from './followUpAction';

vi.mock('@/libs/trpc/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lambdaClient: {
    aiChat: { outputJSON: { mutate: vi.fn(async () => ({ data: { title: 'T' } })) } },
    followUpAction: { extract: { mutate: vi.fn(async () => ({ chips: [] })) } },
  },
}));
vi.mock('@/services/llmRelay', () => ({
  oneShotRelay: { run: vi.fn() },
}));

const RELAY = {
  channel: 'llmcall:user-1:abcdefgh',
  headers: { 'x-lobe-client-id': 'tab-1', 'x-lobe-llm-relay-channel': 'llmcall:user-1:abcdefgh' },
};

describe('structured-output services and the one-shot relay', () => {
  beforeEach(() => {
    vi.mocked(oneShotRelay.run).mockImplementation(async (_provider, request) => request(RELAY));
  });

  // Topic / thread titles and input completion run on the server; a local
  // model there is relayed back to this tab, so the call must name the channel
  // this tab subscribed.
  it('sends outputJSON for the model provider with the relay headers', async () => {
    const params = { messages: [], model: 'qwen3:1.7b', provider: 'ollama', schema: {} } as any;

    const controller = new AbortController();
    await aiChatService.generateJSON(params, controller);

    // The abort signal also ends the wait for the relay channel (input completion).
    expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function), {
      signal: controller.signal,
    });
    expect(lambdaClient.aiChat.outputJSON.mutate).toHaveBeenCalledWith(params, {
      context: { llmRelayHeaders: RELAY.headers, showNotification: false },
      signal: expect.any(AbortSignal),
    });
  });

  it('sends the follow-up extraction for its model provider with the relay headers', async () => {
    const input = { modelConfig: { model: 'qwen3:1.7b', provider: 'lmstudio' }, topicId: 't' };

    const controller = new AbortController();
    await followUpActionService.extract(input as any, controller.signal);

    expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function), {
      signal: controller.signal,
    });
    expect(lambdaClient.followUpAction.extract.mutate).toHaveBeenCalledWith(input, {
      context: { llmRelayHeaders: RELAY.headers },
      signal: controller.signal,
    });
  });
});
