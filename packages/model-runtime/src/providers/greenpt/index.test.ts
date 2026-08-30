// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeGreenPTAI } from './index';

const provider = ModelProvider.GreenPT;
const defaultBaseURL = 'https://api.greenpt.ai/v1';

testProvider({
  Runtime: LobeGreenPTAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_GREENPT_CHAT_COMPLETION',
  chatModel: 'glm-5.2',
});

describe('GreenPT provider extensions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('discovers supported models while excluding the unsupported reranker type', async () => {
    const instance = new LobeGreenPTAI({ apiKey: 'test' });
    vi.spyOn(instance.client.models, 'list').mockResolvedValue({
      data: [
        { id: 'glm-5.2' },
        { id: 'green-embedding' },
        { id: 'green-s' },
        { id: 'green-rerank' },
      ],
    } as any);

    const models = await instance.models();

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'glm-5.2', type: 'chat' }),
        expect.objectContaining({ id: 'green-embedding', type: 'embedding' }),
        expect.objectContaining({ id: 'green-s', type: 'asr' }),
      ]),
    );
    expect(models).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'green-rerank' })]),
    );
  });

  it('transcribes audio through the GreenPT listen endpoint', async () => {
    const instance = new LobeGreenPTAI({ apiKey: 'test-key' });
    const file = new Blob(['audio'], { type: 'audio/wav' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: {
            channels: [
              { alternatives: [{ transcript: ' First channel ' }] },
              { alternatives: [{ transcript: 'Second channel' }] },
            ],
          },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(instance.transcribe({ file, language: 'en', model: 'green-s' })).resolves.toEqual({
      text: 'First channel\nSecond channel',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.greenpt.ai/v1/listen?model=green-s&language=en'),
      expect.objectContaining({
        body: file,
        headers: {
          'Authorization': 'Bearer test-key',
          'Content-Type': 'audio/wav',
        },
        method: 'POST',
      }),
    );
  });
});
