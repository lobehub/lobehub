// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { LobeChatGPTAI } from '../../providers/chatGPT';
import { createOpenAICompatibleRuntime } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const tools: OpenAI.Responses.Tool[] = [
  {
    type: 'namespace',
    name: 'functions',
    description: '',
    tools: [{ type: 'custom', name: 'exec', format: { type: 'text' } }],
  },
];
const closedStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

describe('Responses native tool payload', () => {
  it.each(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra'])(
    'forwards top-level and in-context native tools for %s',
    async (model) => {
      const create = vi.fn().mockImplementation(async () => closedStream());
      const Runtime = createOpenAICompatibleRuntime({
        provider: 'test',
        customClient: { createClient: () => ({ responses: { create } }) as unknown as OpenAI },
      });
      const runtime = new Runtime({ apiKey: 'test' });
      const response = await runtime.chat({
        model,
        apiMode: 'responses',
        stream: true,
        responsesTools: tools,
        messages: [
          { role: 'system', content: '', responsesTools: tools },
          { role: 'user', content: 'Read the file.' },
        ],
      });
      await response.text();
      expect(create.mock.calls[0][0]).toMatchObject({
        tools,
        input: [
          { type: 'additional_tools', role: 'developer', tools },
          { role: 'user', content: 'Read the file.' },
        ],
      });
      expect(create.mock.calls[0][0]).not.toHaveProperty('responsesTools');
    },
  );

  it('preserves a custom-tool-only response when streaming is disabled', async () => {
    const input = 'read("probe.txt")\n';
    const create = vi.fn().mockResolvedValue({
      id: 'resp-custom',
      status: 'completed',
      output: [
        {
          id: 'ct-1',
          type: 'custom_tool_call',
          call_id: 'call-1',
          namespace: 'functions',
          name: 'exec',
          input,
        },
      ],
    });
    const Runtime = createOpenAICompatibleRuntime({
      provider: 'test',
      customClient: { createClient: () => ({ responses: { create } }) as unknown as OpenAI },
    });
    const response = await new Runtime({ apiKey: 'test' }).chat({
      model: 'gpt-5.6-sol',
      apiMode: 'responses',
      stream: false,
      responsesTools: tools,
      messages: [{ role: 'user', content: 'Read the file.' }],
    });
    const raw = await response.text();
    const calls = raw
      .split('\n\n')
      .filter((block) => block.includes('event: tool_calls'))
      .flatMap((block) =>
        JSON.parse(
          block
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
        ),
      );
    expect(calls).toEqual([
      {
        id: 'call-1',
        index: 0,
        namespace: 'functions',
        type: 'custom',
        function: { name: 'exec', arguments: input },
      },
    ]);
    expect(create.mock.calls[0][0].stream).toBeUndefined();
  });

  it('does not prepend an empty tool update to existing Responses Lite tool updates', async () => {
    const runtime = new LobeChatGPTAI({ apiKey: 'test', chatgptAccountId: 'test' });
    const create = vi
      .spyOn(runtime['client'].responses, 'create')
      .mockResolvedValue(closedStream() as never);
    const response = await runtime.chat({
      model: 'gpt-5.6-sol',
      stream: true,
      messages: [
        { role: 'system', content: '', responsesTools: tools },
        { role: 'user', content: 'Read the file.' },
      ],
    });
    await response.text();
    const input = create.mock.calls[0][0].input as OpenAI.Responses.ResponseInputItem[];
    expect(input.filter((item) => item.type === 'additional_tools')).toEqual([
      { role: 'developer', type: 'additional_tools', tools },
    ]);
  });
});
