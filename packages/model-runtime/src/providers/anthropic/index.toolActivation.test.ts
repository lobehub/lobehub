// @vitest-environment node
import type { ToolActivationContext } from '@lobechat/types';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../types';
import { LobeAnthropicAI } from './index';

beforeEach(() => vi.stubEnv('ANTHROPIC_ENABLE_INLINE_TOOLS', '1'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const tool = (name: string) => ({
  function: { description: name, name, parameters: { type: 'object', properties: {} } },
  type: 'function' as const,
});
const initial: ChatStreamPayload = {
  messages: [
    { role: 'system', content: 'base' },
    { role: 'user', content: 'long history' },
  ],
  model: 'claude-sonnet-5-5',
  tools: [tool('activateTools')],
};
const next: ChatStreamPayload = {
  ...initial,
  tools: [...initial.tools!, tool('readDocument')],
  messages: [
    { role: 'system', content: 'base + docs' },
    initial.messages[1],
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'act1', type: 'function', function: { name: 'activateTools', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'act1', content: 'activated' },
  ],
};
const delta: ToolActivationContext = {
  system: {
    current: 'base + docs',
    initial: 'base',
  },
  additions: [{ afterToolCallId: 'act1', instructions: 'docs', names: ['readDocument'] }],
};
function capture(baseURL?: string) {
  const runtime = new LobeAnthropicAI({ apiKey: 'test', baseURL });
  const create = vi
    .spyOn(runtime['client'].messages, 'create')
    .mockImplementation(() => Promise.resolve(new ReadableStream()) as never);
  return { runtime, create };
}
it('preserves tools and system across activation and sends the schema after the paired result', async () => {
  const { runtime, create } = capture();
  await runtime.chat(initial, { getToolActivationContext: async () => ({ additions: [] }) });
  await runtime.chat(next, { getToolActivationContext: async () => delta });
  const [first, second] = create.mock.calls.map(([body]) => body);
  expect(second.system).toEqual(first.system);
  expect(second.tools).toEqual(first.tools);
  expect(first.tools).toMatchObject([
    { name: 'activateTools', cache_control: { type: 'ephemeral' } },
  ]);
  expect(second.messages.slice(-2)).toMatchObject([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'act1' }] },
    {
      role: 'system',
      content: [
        { type: 'text', text: 'docs' },
        {
          type: 'tool_addition',
          tool: { type: 'tool_definition', definition: { name: 'readDocument' } },
        },
      ],
    },
  ]);
  expect(create.mock.calls[1][1]?.headers).toMatchObject({
    'anthropic-beta': expect.stringContaining('inline-tools-2026-09-15'),
  });
});
it('keeps the ordinary payload on an unverified compatible endpoint', async () => {
  const { runtime, create } = capture('https://proxy.example');
  const resolve = vi.fn(async () => delta);
  await runtime.chat(next, { getToolActivationContext: resolve });
  expect(resolve).not.toHaveBeenCalled();
  expect(create.mock.calls[0][0].tools).toMatchObject([
    { name: 'activateTools' },
    { name: 'readDocument' },
  ]);
});

it('falls back with original system and callable schemas when the result is missing', async () => {
  const { runtime, create } = capture();
  await runtime.chat(
    { ...next, messages: next.messages.slice(0, -1) },
    { getToolActivationContext: async () => delta },
  );
  const [body, options] = create.mock.calls[0];
  expect(body.system).toMatchObject([{ text: 'base + docs' }]);
  expect(body.tools).toMatchObject([{ name: 'activateTools' }, { name: 'readDocument' }]);
  expect(options?.headers).toBeUndefined();
});

it('uses the mapped model to exclude Sonnet 5 even on the official endpoint', async () => {
  const runtime = new LobeAnthropicAI({
    apiKey: 'test',
    modelIdMapping: { 'claude-sonnet-5-5': 'claude-sonnet-5' },
  });
  const create = vi
    .spyOn(runtime['client'].messages, 'create')
    .mockResolvedValue(new ReadableStream() as never);
  const resolve = vi.fn(async () => delta);
  await runtime.chat(next, { getToolActivationContext: resolve });
  expect(resolve).not.toHaveBeenCalled();
  expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5');
});

it('keeps parallel results together and preserves beta headers on an opted-in route', async () => {
  const runtime = new LobeAnthropicAI({
    apiKey: 'test',
    baseURL: 'https://proxy.example',
    defaultHeaders: { 'Anthropic-Beta': 'route-beta,inline-tools-2026-09-15' },
  });
  const create = vi
    .spyOn(runtime['client'].messages, 'create')
    .mockResolvedValue(new ReadableStream() as never);
  const sibling = {
    id: 'sibling',
    type: 'function',
    function: { name: 'activateTools', arguments: '{}' },
  };
  const payload = {
    ...next,
    messages: [
      ...next.messages.slice(0, 2),
      { ...next.messages[2], tool_calls: [...next.messages[2].tool_calls!, sibling] },
      next.messages[3],
      { role: 'tool' as const, tool_call_id: sibling.id, content: 'done' },
    ],
  };
  await runtime.chat(payload, {
    getToolActivationContext: async () => delta,
    requestHeaders: { 'anthropic-beta': 'request-beta' },
  });
  const [body, options] = create.mock.calls[0];
  expect(body.messages.slice(-2)).toMatchObject([
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'act1' },
        { type: 'tool_result', tool_use_id: 'sibling' },
      ],
    },
    {
      role: 'system',
      content: [{ type: 'text' }, { type: 'tool_addition', cache_control: { type: 'ephemeral' } }],
    },
  ]);
  expect(options?.headers).toMatchObject({
    'anthropic-beta': 'route-beta,inline-tools-2026-09-15,request-beta',
  });
});

it('replays the addition before a later call to the activated tool', async () => {
  const { runtime, create } = capture();
  await runtime.chat(next, { getToolActivationContext: async () => delta });
  await runtime.chat(
    {
      ...next,
      messages: [
        ...next.messages,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'read1', type: 'function', function: { name: 'readDocument', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'read1', content: 'document' },
      ],
    },
    { getToolActivationContext: async () => delta },
  );
  const [activation, followUp] = create.mock.calls.map(([body]) => body);
  expect(followUp.system).toEqual(activation.system);
  expect(followUp.tools).toEqual(activation.tools);
  expect(followUp.messages.slice(0, -3)).toEqual(activation.messages.slice(0, -1));
  expect(followUp.messages.slice(-3)).toMatchObject([
    {
      role: 'system',
      content: [
        { type: 'text' },
        { type: 'tool_addition', tool: { definition: { name: 'readDocument' } } },
      ],
    },
    { role: 'assistant', content: [{ type: 'tool_use', name: 'readDocument' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read1' }] },
  ]);
});

it('leaves both the cold and activated request unchanged unless the server opts in', async () => {
  vi.stubEnv('ANTHROPIC_ENABLE_INLINE_TOOLS', undefined);
  const { runtime, create } = capture();
  const resolve = vi.fn(async () => delta);
  for (const payload of [initial, next]) {
    await runtime.chat(payload);
    await runtime.chat(payload, { getToolActivationContext: resolve });
    expect(create.mock.calls.at(-1)).toEqual(create.mock.calls.at(-2));
  }
  expect(resolve).not.toHaveBeenCalled();
});

it('sends the ordinary cold request even when the feature is enabled', async () => {
  const { runtime, create } = capture();
  await runtime.chat(initial);
  await runtime.chat(initial, { getToolActivationContext: async () => ({ additions: [] }) });
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
});

it.each([
  [
    'a synthetic todo reminder',
    [{ role: 'user', content: '<todo_context>finish the task</todo_context>' }],
  ],
  [
    'a resumed user after an empty assistant turn',
    [
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Continue.' },
    ],
  ],
] as const)('preserves the ordinary request before %s', async (_, tail) => {
  const { runtime, create } = capture();
  const payload = { ...next, messages: [...next.messages, ...tail] };
  await runtime.chat(payload);
  await runtime.chat(payload, { getToolActivationContext: async () => delta });
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
});
