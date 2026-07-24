// @vitest-environment node
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeChatGPTAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

describe('LobeChatGPTAI', () => {
  let instance: InstanceType<typeof LobeChatGPTAI>;

  beforeEach(() => {
    instance = new LobeChatGPTAI({
      apiKey: 'access-token',
      chatgptAccountId: 'account-id',
    });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as never,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(
      new ReadableStream() as never,
    );
  });

  it('configures the Codex endpoint and OAuth account headers', () => {
    const headers = instance['client']['_options'].defaultHeaders;

    expect(instance.baseURL).toBe('https://chatgpt.com/backend-api/codex');
    expect(instance['client'].apiKey).toBe('access-token');
    expect(headers['ChatGPT-Account-Id']).toBe('account-id');
    expect(headers['User-Agent']).toBe('LobeHub/1.0');
    expect(headers.originator).toBe('lobehub');
    expect(headers['session-id']).toEqual(expect.any(String));
  });

  it('always uses Responses API and omits public API output limits', async () => {
    await instance.chat({
      apiMode: 'chatCompletion',
      max_tokens: 4096,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      stream: true,
    });

    const request = (instance['client'].responses.create as Mock).mock.calls[0][0];

    expect(request).toMatchObject({
      include: ['reasoning.encrypted_content'],
      input: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      store: false,
      stream: true,
    });
    expect(request.max_output_tokens).toBeUndefined();
    expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
  });

  it('reuses OpenAI Responses payload handling for reasoning and web search', async () => {
    await instance.chat({
      enabledSearch: true,
      messages: [{ content: 'Search for this', role: 'user' }],
      model: 'gpt-5.5',
      reasoning_effort: 'high',
    });

    const request = (instance['client'].responses.create as Mock).mock.calls[0][0];

    expect(request.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(request.tools).toContainEqual({ type: 'web_search' });
  });
});
