// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as responsesInputs from '../protocols/openaiResponses/inputs';
import { createOpenAICompatibleRuntime } from './index';

const closedResponseSource = {
  toReadableStream: () =>
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
};

describe('LobeOpenAICompatibleFactory Responses input conversion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should enable strictToolPairing when building Responses API input', async () => {
    const LobeMockProviderUseResponses = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: {
        useResponse: true,
      },
      provider: ModelProvider.OpenAI,
    });

    const inst = new LobeMockProviderUseResponses({ apiKey: 'test' });
    const convertSpy = vi
      .spyOn(responsesInputs, 'convertOpenAIResponseInputs')
      .mockResolvedValue([{ role: 'user', content: 'mocked input' }] as any);

    vi.spyOn(inst['client'].responses, 'create').mockResolvedValue(closedResponseSource as any);

    try {
      await inst.chat({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'any-model',
        temperature: 0,
      });
    } catch {
      // Ignore stream mock limitations; we only care about input conversion options.
    }

    expect(convertSpy).toHaveBeenCalledWith(
      [{ content: 'hi', role: 'user' }],
      expect.objectContaining({
        forceImageBase64: undefined,
        forceVideoBase64: undefined,
        strictToolPairing: true,
      }),
    );
    convertSpy.mockRestore();
  });

  it('should bind encrypted reasoning to the ChatGPT subscription account', async () => {
    const Runtime = createOpenAICompatibleRuntime({
      baseURL: 'https://chatgpt.com/backend-api/codex',
      chatCompletion: { useResponse: true },
      provider: ModelProvider.ChatGPT,
    });
    const convertSpy = vi
      .spyOn(responsesInputs, 'convertOpenAIResponseInputs')
      .mockRejectedValue({ status: 400 });

    for (const chatgptAccountId of ['account-a', 'account-b']) {
      const inst = new Runtime({ apiKey: 'oauth-token', chatgptAccountId });
      await expect(
        inst.chat({
          messages: [{ content: 'hi', role: 'user' }],
          model: 'gpt-5.6-sol',
          temperature: 0,
        }),
      ).rejects.toBeDefined();
    }

    const fingerprints = convertSpy.mock.calls.map(
      ([, options]) => options?.reasoningSignatureScope?.fingerprint,
    );
    expect(fingerprints[0]).toMatch(/^[\da-f]{32}$/);
    expect(fingerprints[1]).toMatch(/^[\da-f]{32}$/);
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
    expect(fingerprints).not.toContain('account-a');
    expect(fingerprints).not.toContain('account-b');
    convertSpy.mockRestore();
  });
});
