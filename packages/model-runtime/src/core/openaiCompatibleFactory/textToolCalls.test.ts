// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatCompletionTool } from '../../types/chat';
import { createOpenAICompatibleRuntime } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../utils/model', () => ({
  getModelPricing: vi.fn().mockResolvedValue({}),
}));

const tools: ChatCompletionTool[] = [
  {
    function: {
      name: 'search',
      parameters: { properties: { query: { type: 'string' } }, type: 'object' },
    },
    type: 'function',
  },
];

const TEXT_TOOL_CALL =
  '<tool_call>\n<function=search>\n<parameter=query>\nqwen\n</parameter>\n</function>\n</tool_call>';

const runChat = async (options: { disableTextToolCallFallback?: boolean } = {}) => {
  const Runtime = createOpenAICompatibleRuntime({
    baseURL: 'https://api.example.com/v1',
    chatCompletion: { disableTextToolCallFallback: options.disableTextToolCallFallback },
    provider: ModelProvider.OpenAI,
  });
  const runtime = new Runtime({ apiKey: 'test' });

  const upstream = new ReadableStream({
    start(controller) {
      for (const [content, finish_reason] of [
        [TEXT_TOOL_CALL, null],
        ['', 'stop'],
      ] as const) {
        controller.enqueue({
          choices: [{ delta: { content }, finish_reason, index: 0 }],
          created: 1,
          id: 'chatcmpl-1',
          model: 'qwen3-coder-flash',
          object: 'chat.completion.chunk',
        });
      }
      controller.close();
    },
  });
  vi.spyOn(runtime['client'].chat.completions, 'create').mockResolvedValue(upstream as any);

  const onCompletion = vi.fn();
  const response = await runtime.chat(
    {
      messages: [{ content: 'search qwen', role: 'user' }],
      model: 'qwen3-coder-flash',
      stream: true,
      temperature: 0,
      tools,
    },
    { callback: { onCompletion } },
  );
  const reader = response.body!.getReader();
  while (!(await reader.read()).done);

  return onCompletion.mock.calls[0][0];
};

describe('openaiCompatibleFactory text tool call fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('converts text tool calls when the request declares tools', async () => {
    const data = await runChat();

    expect(data.text).toBe('');
    expect(data.toolsCalling).toMatchObject([
      { function: { arguments: '{"query":"qwen"}', name: 'search' } },
    ]);
  });

  it('keeps the text when the provider disables the fallback', async () => {
    const data = await runChat({ disableTextToolCallFallback: true });

    expect(data.text).toBe(TEXT_TOOL_CALL);
    expect(data.toolsCalling).toBeUndefined();
  });

  it('keeps the text when the env kill switch is on', async () => {
    vi.stubEnv('DISABLE_TEXT_TOOL_CALL_FALLBACK', '1');

    const data = await runChat();

    expect(data.text).toBe(TEXT_TOOL_CALL);
    expect(data.toolsCalling).toBeUndefined();
  });
});
