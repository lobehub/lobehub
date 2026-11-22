import { describe, expect, it } from 'vitest';

import type { ChatCompletionTool, OpenAIChatMessage } from '../../../types';
import { convertOpenAIResponseInputs } from './inputs';
import {
  buildAnchoredToolItems,
  INCREMENTAL_TOOLS_NOTICE,
  prepareAnchoredMessages,
  resolveOpenAIToolAnchoring,
  splitAnchoredTools,
} from './toolAnchoring';

const fn = (name: string): ChatCompletionTool => ({
  function: { description: `${name} tool`, name, parameters: { properties: {}, type: 'object' } },
  type: 'function',
});

const activator = fn('lobe-activator____activateTools');
const search = fn('lobe-web-browsing____search');
const crawl = fn('lobe-web-browsing____crawlSinglePage');
const notion = fn('notion____createPage____mcp');

const activation = (
  id: string,
  toolsAdded: string[],
  extraCalls: string[] = [],
): OpenAIChatMessage[] => [
  {
    content: '',
    role: 'assistant',
    tool_calls: [id, ...extraCalls].map((callId) => ({
      function: { arguments: '{}', name: activator.function.name },
      id: callId,
      type: 'function' as const,
    })),
  },
  { content: 'Successfully activated tools.', role: 'tool', tool_call_id: id, toolsAdded },
  ...extraCalls.map((callId): OpenAIChatMessage => ({
    content: 'ok',
    role: 'tool',
    tool_call_id: callId,
  })),
];

describe('prepareAnchoredMessages', () => {
  it('keeps the canonical prompt when one schema in an activation batch is filtered out', () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'system', content: 'Tool guidance' },
      ...activation('call', []),
    ];
    messages[2].toolActivationPlan = {
      results: [
        {
          callId: 'call',
          content: 'Activated tools and guidance',
          toolNames: [search.function.name, crawl.function.name],
        },
      ],
      system: { start: 0, original: 'Tool guidance', replacement: '' },
    };
    expect(prepareAnchoredMessages(messages, [search])).toBe(messages);
  });
});

describe('splitAnchoredTools', () => {
  it('keeps every tool at the top level when no message announces one', () => {
    const tools = [activator, search];
    const result = splitAnchoredTools([{ content: 'hi', role: 'user' }], tools);

    expect(result.requestTools).toBe(tools);
    expect(result.anchored.size).toBe(0);
  });

  it('moves announced tools out of the top-level list, at the message that announced them', () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'find it', role: 'user' },
      ...activation('call_1', [search.function.name, crawl.function.name]),
    ];

    const result = splitAnchoredTools(messages, [activator, search, crawl]);

    expect(result.requestTools).toEqual([activator]);
    expect([...result.anchored]).toEqual([[2, [search, crawl]]]);
  });

  it('anchors a tool once, at the first message that announces it', () => {
    const messages: OpenAIChatMessage[] = [
      ...activation('call_1', [search.function.name]),
      ...activation('call_2', [search.function.name, notion.function.name]),
    ];

    const result = splitAnchoredTools(messages, [activator, search, notion]);

    expect([...result.anchored]).toEqual([
      [1, [search]],
      [3, [notion]],
    ]);
  });

  it('leaves a tool at the top level when its announcing message is dropped as unpaired', () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'orphan', role: 'tool', tool_call_id: 'gone', toolsAdded: [search.function.name] },
    ];

    const strict = splitAnchoredTools(messages, [activator, search], { strictToolPairing: true });
    expect(strict.requestTools).toEqual([activator, search]);
    expect(strict.anchored.size).toBe(0);

    const loose = splitAnchoredTools(messages, [activator, search]);
    expect(loose.requestTools).toEqual([activator]);
  });

  it('ignores announced names that are not offered this step', () => {
    const messages = activation('call_1', [search.function.name, 'removed____tool']);

    const result = splitAnchoredTools(messages, [activator, search]);

    expect([...result.anchored]).toEqual([[1, [search]]]);
  });

  it('keeps non-function tools at the top level', () => {
    const webSearch = { type: 'web_search' };
    const messages = activation('call_1', [search.function.name]);

    const result = splitAnchoredTools(messages, [activator, webSearch, search]);

    expect(result.requestTools).toEqual([activator, webSearch]);
  });
});

describe('buildAnchoredToolItems', () => {
  it('declares additional_tools behind the incremental notice', () => {
    expect(buildAnchoredToolItems('additional_tools', [search], 'call_1')).toEqual([
      { content: INCREMENTAL_TOOLS_NOTICE, role: 'developer' },
      {
        role: 'developer',
        tools: [
          {
            description: 'lobe-web-browsing____search tool',
            name: 'lobe-web-browsing____search',
            parameters: { properties: {}, type: 'object' },
            type: 'function',
          },
        ],
        type: 'additional_tools',
      },
    ]);
  });

  it('declares a completed client tool search carrying deferred definitions', () => {
    const [call, output] = buildAnchoredToolItems('tool_search', [search, crawl], 'toolu:01/a b');

    expect(call).toEqual({
      arguments: {
        limit: 2,
        query: 'lobe-web-browsing____search lobe-web-browsing____crawlSinglePage',
      },
      call_id: 'lobe_tool_load_toolu_01_a_b',
      execution: 'client',
      status: 'completed',
      type: 'tool_search_call',
    });
    expect(output).toMatchObject({
      call_id: 'lobe_tool_load_toolu_01_a_b',
      execution: 'client',
      status: 'completed',
      tools: [
        { defer_loading: true, name: 'lobe-web-browsing____search', type: 'function' },
        { defer_loading: true, name: 'lobe-web-browsing____crawlSinglePage', type: 'function' },
      ],
      type: 'tool_search_output',
    });
  });
});

describe('convertOpenAIResponseInputs with tool anchors', () => {
  it('declares the tools after the tool batch that activated them', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'find it', role: 'user' },
      ...activation('call_1', [search.function.name], ['call_2']),
      { content: 'next', role: 'user' },
    ];
    const { anchored } = splitAnchoredTools(messages, [activator, search], {
      strictToolPairing: true,
    });

    const input = await convertOpenAIResponseInputs(messages, {
      strictToolPairing: true,
      toolAnchors: { byMessageIndex: anchored, mode: 'additional_tools' },
    });

    expect(input.map((item: any) => item.type ?? item.role)).toEqual([
      'user',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
      'developer',
      'additional_tools',
      'user',
    ]);
    // The annotation is ours; it never reaches the wire.
    expect(JSON.stringify(input)).not.toContain('toolsAdded');
  });

  it('emits nothing extra without anchors', async () => {
    const messages = activation('call_1', [search.function.name]);

    const input = await convertOpenAIResponseInputs(messages, { strictToolPairing: true });

    expect(input.map((item: any) => item.type)).toEqual(['function_call', 'function_call_output']);
    expect(JSON.stringify(input)).not.toContain('toolsAdded');
  });
});

describe('resolveOpenAIToolAnchoring', () => {
  it.each([
    [undefined, 'additional_tools'],
    ['https://api.openai.com/v1', 'additional_tools'],
    ['https://relay.example.com/v1', undefined],
    ['not a url', undefined],
  ])('anchors on the official endpoint only by default (%s)', (baseURL, expected) => {
    expect(resolveOpenAIToolAnchoring({ baseURL, isSupportedModel: true })).toBe(expected);
  });

  it.each([
    ['0', undefined],
    ['off', undefined],
    ['1', 'additional_tools'],
    ['additional_tools', 'additional_tools'],
    ['tool_search', 'tool_search'],
  ])('lets the operator override the endpoint default (%s)', (override, expected) => {
    for (const baseURL of ['https://api.openai.com/v1', 'https://relay.example.com/v1']) {
      expect(resolveOpenAIToolAnchoring({ baseURL, isSupportedModel: true, override })).toBe(
        expected,
      );
    }
  });

  it('never anchors for a model that cannot take in-conversation tools', () => {
    expect(
      resolveOpenAIToolAnchoring({ isSupportedModel: false, override: 'additional_tools' }),
    ).toBeUndefined();
  });
});
