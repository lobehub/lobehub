// @vitest-environment node
import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeChatGPTAI } from '../../providers/chatGPT';
import { LobeOpenAI } from '../../providers/openai';
import type { ChatCompletionTool, OpenAIChatMessage } from '../../types';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const fn = (name: string): ChatCompletionTool => ({
  function: { description: `${name} tool`, name, parameters: { properties: {}, type: 'object' } },
  type: 'function',
});

const activator = fn('lobe-activator____activateTools');
const search = fn('lobe-web-browsing____search');
const notion = fn('notion____createPage____mcp');

const closedStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

/**
 * One agent run that activates a tool at step 1 and an MCP tool at step 3. Each entry
 * is the request the runtime receives at that step: the conversation so far, plus every
 * tool resolved for the step (the activated ones appended, as `ToolResolver` does).
 */
const buildRun = (): Array<{ messages: OpenAIChatMessage[]; tools: ChatCompletionTool[] }> => {
  const turn1: OpenAIChatMessage[] = [
    { content: 'You are a helpful assistant.', role: 'system' },
    { content: 'Find the release notes and file them in Notion.', role: 'user' },
  ];
  const turn2: OpenAIChatMessage[] = [
    ...turn1,
    {
      content: '',
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{"tools":["lobe-web-browsing"]}', name: activator.function.name },
          id: 'call_activate_search',
          type: 'function',
        },
      ],
    },
    {
      content: 'Successfully activated tools: lobe-web-browsing.search.',
      role: 'tool',
      tool_call_id: 'call_activate_search',
      toolsAdded: [search.function.name],
    },
  ];
  const turn3: OpenAIChatMessage[] = [
    ...turn2,
    {
      content: '',
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{"query":"release notes"}', name: search.function.name },
          id: 'call_search',
          type: 'function',
        },
      ],
    },
    { content: 'Release notes: ...', role: 'tool', tool_call_id: 'call_search' },
    {
      content: '',
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{"tools":["notion"]}', name: activator.function.name },
          id: 'call_activate_notion',
          type: 'function',
        },
      ],
    },
    {
      content: 'Successfully activated tools: notion.createPage.',
      role: 'tool',
      tool_call_id: 'call_activate_notion',
      toolsAdded: [notion.function.name],
    },
  ];

  return [
    { messages: turn1, tools: [activator] },
    { messages: turn2, tools: [activator, search] },
    { messages: turn3, tools: [activator, search, notion] },
  ];
};

type ResponsesRequest = {
  input: OpenAI.Responses.ResponseInputItem[];
  tools?: OpenAI.Responses.Tool[];
};

const captureRun = async (
  runtime: LobeOpenAI | LobeChatGPTAI,
  model: string,
): Promise<ResponsesRequest[]> => {
  const create = vi
    .spyOn((runtime as any).client.responses, 'create')
    .mockImplementation(async () => closedStream() as never);

  for (const step of buildRun()) {
    const response = await runtime.chat({ ...step, model, stream: true } as any);
    await response.text();
  }

  return create.mock.calls.map(([request]) => request as ResponsesRequest);
};

/** Each request must only append to the one before it, or the prompt cache is lost. */
const expectGrowingPrefix = (requests: ResponsesRequest[]) => {
  for (let index = 1; index < requests.length; index++) {
    const previous = requests[index - 1];
    const current = requests[index];

    expect(current.tools).toEqual(previous.tools);
    expect(current.input.slice(0, previous.input.length)).toEqual(previous.input);
  }
};

const toolNames = (tools: OpenAI.Responses.Tool[] | undefined) =>
  (tools ?? []).map((tool) => (tool as { name?: string }).name);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Responses tool anchoring', () => {
  it.each(['gpt-5.6-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.2-astra'])(
    'keeps the request prefix stable when %s activates tools mid-run',
    async (model) => {
      const requests = await captureRun(new LobeOpenAI({ apiKey: 'test' }), model);

      expectGrowingPrefix(requests);
      for (const request of requests) {
        expect(toolNames(request.tools)).toEqual([activator.function.name]);
      }

      const declared = requests
        .at(-1)!
        .input.filter((item) => item.type === 'additional_tools')
        .map((item) =>
          toolNames((item as OpenAI.Responses.ResponseInputItem.AdditionalTools).tools),
        );
      expect(declared).toEqual([[search.function.name], [notion.function.name]]);
    },
  );

  it('anchors with a client tool search exchange when the operator asks for it', async () => {
    vi.stubEnv('OPENAI_RESPONSES_TOOL_ANCHORING', 'tool_search');

    const requests = await captureRun(
      new LobeOpenAI({ apiKey: 'test', baseURL: 'https://relay.example.com/v1' }),
      'gpt-6.1-sol',
    );

    expectGrowingPrefix(requests);
    const last = requests.at(-1)!;
    expect(toolNames(last.tools)).toEqual([activator.function.name]);
    expect(last.input.some((item) => item.type === 'additional_tools')).toBe(false);
    expect(
      last.input
        .filter((item) => item.type === 'tool_search_output')
        .map((item) => (item as OpenAI.Responses.ResponseToolSearchOutputItemParam).tools),
    ).toEqual([
      [expect.objectContaining({ defer_loading: true, name: search.function.name })],
      [expect.objectContaining({ defer_loading: true, name: notion.function.name })],
    ]);
    // Every output answers the call right before it.
    const callIds = last.input
      .filter((item) => item.type === 'tool_search_call' || item.type === 'tool_search_output')
      .map((item) => (item as { call_id?: string }).call_id);
    expect(callIds).toEqual([
      'lobe_tool_load_call_activate_search',
      'lobe_tool_load_call_activate_search',
      'lobe_tool_load_call_activate_notion',
      'lobe_tool_load_call_activate_notion',
    ]);
  });

  it.each([
    ['a model older than GPT-5.6', 'gpt-5.5', {}, undefined],
    ['a relay endpoint', 'gpt-6.1-sol', { baseURL: 'https://relay.example.com/v1' }, undefined],
    ['an operator opt-out', 'gpt-6.1-sol', {}, '0'],
  ])('keeps every tool in the top-level list for %s', async (_case, model, options, override) => {
    if (override) vi.stubEnv('OPENAI_RESPONSES_TOOL_ANCHORING', override);

    const requests = await captureRun(new LobeOpenAI({ apiKey: 'test', ...options }), model);

    expect(requests.map((request) => toolNames(request.tools))).toEqual([
      [activator.function.name],
      [activator.function.name, search.function.name],
      [activator.function.name, search.function.name, notion.function.name],
    ]);
    const wire = JSON.stringify(requests);
    expect(wire).not.toContain('additional_tools');
    expect(wire).not.toContain('tool_search');
    expect(wire).not.toContain('toolsAdded');
  });

  it('keeps the Codex backend prefix stable, Responses Lite included', async () => {
    for (const model of ['gpt-5.6-sol', 'gpt-6.1-sol']) {
      const requests = await captureRun(
        new LobeChatGPTAI({ apiKey: 'test', chatgptAccountId: 'test' }),
        model,
      );

      expectGrowingPrefix(requests);
      const declared = requests
        .at(-1)!
        .input.filter((item) => item.type === 'additional_tools')
        .flatMap((item) =>
          toolNames((item as OpenAI.Responses.ResponseInputItem.AdditionalTools).tools),
        );
      // Responses Lite also moves the base tools into a leading additional_tools item.
      expect(declared.slice(-2)).toEqual([search.function.name, notion.function.name]);
      expect(declared).not.toHaveLength(0);
    }
  });
});
