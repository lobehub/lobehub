// @vitest-environment node
import { CURRENT_VERSION } from '@lobechat/const';
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
    expect(headers).toEqual(
      expect.objectContaining({
        'ChatGPT-Account-Id': 'account-id',
        'User-Agent': `LobeHub/${CURRENT_VERSION}`,
        'originator': 'lobehub',
        'session-id': expect.any(String),
        'version': CURRENT_VERSION,
      }),
    );
  });

  it('always uses Responses API and omits public API output limits', async () => {
    await instance.chat(
      {
        apiMode: 'chatCompletion',
        max_tokens: 4096,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-5.5',
        stream: true,
      },
      { user: 'user-id' },
    );

    const [request, requestOptions] = (instance['client'].responses.create as Mock).mock.calls[0];

    expect(request).toMatchObject({
      include: ['reasoning.encrypted_content'],
      input: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.5',
      store: false,
      stream: true,
    });
    expect(request.max_output_tokens).toBeUndefined();
    expect(request.safety_identifier).toBeUndefined();
    expect(requestOptions.headers).not.toHaveProperty('x-openai-internal-codex-responses-lite');
    expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
  });

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'uses the Responses Lite request contract for %s',
    async (model) => {
      await instance.chat(
        {
          messages: [
            { content: 'Follow the instructions', role: 'system' },
            { content: 'Check the weather', role: 'user' },
          ],
          model,
          reasoning_effort: 'high',
          tools: [
            {
              function: {
                description: 'Get the weather',
                name: 'get_weather',
                parameters: {
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                  type: 'object',
                },
              },
              type: 'function',
            },
          ],
        },
        { user: 'user-id' },
      );

      const [request, requestOptions] = (instance['client'].responses.create as Mock).mock.calls[0];

      expect(requestOptions.headers).toMatchObject({
        'x-openai-internal-codex-responses-lite': 'true',
      });
      expect(request).toMatchObject({
        input: [
          {
            role: 'developer',
            tools: [
              {
                description: 'Get the weather',
                name: 'get_weather',
                parameters: {
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                  type: 'object',
                },
                type: 'function',
              },
            ],
            type: 'additional_tools',
          },
          { content: 'Follow the instructions', role: 'developer' },
          { content: 'Check the weather', role: 'user' },
        ],
        parallel_tool_calls: false,
        reasoning: { context: 'all_turns', effort: 'high', summary: 'auto' },
        tool_choice: 'auto',
      });
      expect(request.instructions).toBeUndefined();
      expect(request.safety_identifier).toBeUndefined();
      expect(request.tools).toBeUndefined();
    },
  );

  it('uses the Responses Lite contract for structured output', async () => {
    (instance['client'].responses.create as Mock).mockResolvedValue({
      output_text: '{"city":"Hangzhou"}',
    });

    const result = await instance.generateObject(
      {
        messages: [{ content: 'Extract the city', role: 'user' }],
        model: 'gpt-5.6-sol',
        schema: {
          name: 'location',
          schema: {
            properties: { city: { type: 'string' } },
            required: ['city'],
            type: 'object',
          },
        },
      },
      { headers: { 'x-request-id': 'request-id' }, user: 'user-id' },
    );

    const [request, requestOptions] = (instance['client'].responses.create as Mock).mock.calls[0];

    expect(result).toEqual({ city: 'Hangzhou' });
    expect(request).toMatchObject({
      input: [
        { role: 'developer', tools: [], type: 'additional_tools' },
        { content: 'Extract the city', role: 'user' },
      ],
      model: 'gpt-5.6-sol',
      reasoning: { context: 'all_turns' },
      text: {
        format: {
          name: 'location',
          schema: {
            properties: { city: { type: 'string' } },
            required: ['city'],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      },
      tool_choice: 'auto',
    });
    expect(request.safety_identifier).toBeUndefined();
    expect(requestOptions.headers).toMatchObject({
      'x-openai-internal-codex-responses-lite': 'true',
      'x-request-id': 'request-id',
    });
  });

  it('uses Responses Lite tools while preserving required tool choice', async () => {
    (instance['client'].responses.create as Mock).mockResolvedValue({
      output: [
        {
          arguments: '{"city":"Hangzhou"}',
          name: 'extract_location',
          type: 'function_call',
        },
      ],
    });

    const result = await instance.generateObject(
      {
        messages: [{ content: 'Extract the city', role: 'user' }],
        model: 'gpt-5.6-sol',
        tools: [
          {
            function: {
              name: 'extract_location',
              parameters: {
                properties: { city: { type: 'string' } },
                required: ['city'],
                type: 'object',
              },
            },
            type: 'function',
          },
        ],
      },
      { user: 'user-id' },
    );

    const [request, requestOptions] = (instance['client'].responses.create as Mock).mock.calls[0];

    expect(result).toEqual([{ arguments: { city: 'Hangzhou' }, name: 'extract_location' }]);
    expect(request).toMatchObject({
      input: [
        {
          role: 'developer',
          tools: [
            {
              name: 'extract_location',
              parameters: {
                properties: { city: { type: 'string' } },
                required: ['city'],
                type: 'object',
              },
              type: 'function',
            },
          ],
          type: 'additional_tools',
        },
        { content: 'Extract the city', role: 'user' },
      ],
      parallel_tool_calls: false,
      reasoning: { context: 'all_turns' },
      tool_choice: 'required',
    });
    expect(request.safety_identifier).toBeUndefined();
    expect(request.tools).toBeUndefined();
    expect(requestOptions.headers).toMatchObject({
      'x-openai-internal-codex-responses-lite': 'true',
    });
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
