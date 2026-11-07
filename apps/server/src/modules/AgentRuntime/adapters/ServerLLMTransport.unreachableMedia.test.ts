// @vitest-environment node
import type { LLMAttemptInput } from '@lobechat/agent-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  resolveProviderResponseApiMode: vi.fn(async () => undefined),
  resolveServerModel: vi.fn(),
}));

vi.mock('../llmRelay/resolveLlmExecutionSite', () => ({
  resolveLlmExecutionSite: vi.fn(async () => ({ site: 'server' })),
}));

const DEAD = 'https://app.lobehub.com/f/file_vAKwgeDznm71';
const ALIVE = 'https://app.lobehub.com/f/file_alive';

const createCtx = () =>
  ({
    operationId: 'op-1',
    serverDB: {},
    stepIndex: 0,
    streamManager: {
      publishStreamChunk: vi.fn().mockResolvedValue('chunk-id'),
      publishStreamEvent: vi.fn().mockResolvedValue('event-id'),
    },
    toolExecutionService: {},
    userId: 'user-1',
  }) as unknown as RuntimeExecutorContext;

const createInput = (): LLMAttemptInput =>
  ({
    assistantMessageId: 'msg-1',
    attempt: 1,
    context: {
      messages: [
        {
          content: [
            { text: 'Earlier screenshot', type: 'text' },
            { image_url: { url: DEAD }, type: 'image_url' },
            { image_url: { url: ALIVE }, type: 'image_url' },
          ],
          role: 'user',
        },
        { content: 'Deploy it', role: 'user' },
      ],
      modelParameters: {},
      replayAssistantReasoning: false,
      resolvedTools: {
        enabledToolIds: [],
        executorMap: {},
        manifestMap: {},
        promptManifestMap: {},
        sourceMap: {},
        tools: [],
      },
    } as unknown as LLMAttemptInput['context'],
    events: [],
    maxAttempts: 1,
    model: 'gpt-4o',
    provider: 'openai',
    state: {},
  }) as unknown as LLMAttemptInput;

const downloadFailure = (url: string) => ({
  error: { message: `400 Error while downloading ${url}.` },
  // What the OpenAI-compatible adapter assigns after refining the 400.
  errorType: 'RemoteMediaDownloadFailed',
  provider: 'openai',
});

const answer = async (_payload: unknown, options?: any) => {
  await options?.callback?.onText?.('Deployed');
  await options?.callback?.onCompletion?.({ text: 'Deployed', usage: { totalOutputTokens: 1 } });
  return new Response('Deployed');
};

const imageUrlsOf = (payload: any) =>
  payload.messages[0].content
    .filter((p: any) => p.type === 'image_url')
    .map((p: any) => p.image_url.url);

/**
 * Regression: one image in the history that the provider could not
 * download (`Error while downloading https://app.lobehub.com/f/<id>`) rejected
 * the whole request with 400, on every attempt and every later turn, so a
 * sub-agent dispatched with that history never started.
 */
describe('ServerLLMTransport · media the provider cannot download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the dead image, notes it, and sends the request again', async () => {
    const chat = vi.fn().mockRejectedValueOnce(downloadFailure(DEAD)).mockImplementation(answer);
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const execution = await new ServerLLMTransport(createCtx()).runAttempt(createInput());

    expect(execution.ok).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(imageUrlsOf(chat.mock.calls[0][0])).toEqual([DEAD, ALIVE]);
    expect(imageUrlsOf(chat.mock.calls[1][0])).toEqual([ALIVE]);
    expect(JSON.stringify(chat.mock.calls[1][0].messages)).toContain('Image unavailable');
  });

  it('does not send the dead link again on a later attempt', async () => {
    const chat = vi.fn().mockRejectedValueOnce(downloadFailure(DEAD)).mockImplementation(answer);
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const transport = new ServerLLMTransport(createCtx());
    await transport.runAttempt(createInput());
    await transport.runAttempt(createInput());

    expect(chat).toHaveBeenCalledTimes(3);
    expect(imageUrlsOf(chat.mock.calls[2][0])).toEqual([ALIVE]);
  });

  it('reports other failures without resending', async () => {
    const chat = vi.fn().mockRejectedValue({
      error: { message: 'Invalid request' },
      errorType: 'ProviderBizError',
      provider: 'openai',
    });
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async () => new ModelRuntime({ chat }));

    const execution = await new ServerLLMTransport(createCtx()).runAttempt(createInput());

    expect(execution.ok).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
