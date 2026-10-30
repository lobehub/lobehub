// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { LobeJZSTOKENAI, params } from './index';

describe('LobeJZSTOKENAI', () => {
  it('uses the JZSTOKEN OpenAI-compatible endpoint', () => {
    expect(params.baseURL).toBe('https://jzstoken.com/api/v1');
    expect(params.provider).toBe(ModelProvider.JZSTOKEN);
    expect(new LobeJZSTOKENAI({ apiKey: 'test' })).toBeDefined();
  });

  it('forces streaming chat requests', () => {
    const result = params.chatCompletion.handlePayload({
      apiMode: 'responses',
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-terra',
      stream: false,
    });

    expect(result).not.toHaveProperty('apiMode');
    expect(result.stream).toBe(true);
  });

  it('keeps Responses-capable model IDs on the Chat Completions path', async () => {
    const instance = new LobeJZSTOKENAI({ apiKey: 'test' });
    const create = vi
      .spyOn(instance['client'].chat.completions, 'create')
      .mockResolvedValue(new ReadableStream() as any);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.6-terra',
    });

    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ apiMode: expect.anything() }),
      expect.anything(),
    );
  });

  it('fetches the key-scoped model list', async () => {
    const client = {
      models: {
        list: vi.fn().mockResolvedValue({
          data: [
            { id: 'gpt-5.6-terra', object: 'model', owned_by: 'jzstoken' },
            { id: 'claude-sonnet-5', object: 'model', owned_by: 'jzstoken' },
          ],
        }),
      },
    };

    const models = await params.models({ client: client as any });

    expect(client.models.list).toHaveBeenCalledOnce();
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-terra', 'claude-sonnet-5']);
  });
});
