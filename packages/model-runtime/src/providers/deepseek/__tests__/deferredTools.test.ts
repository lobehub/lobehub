// @vitest-environment node
import './testUtils';

import type { ToolActivationContext } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../../types';
import { LobeDeepSeekAnthropicAI } from '../index';

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
  model: 'deepseek-flash',
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

function capture(options: ConstructorParameters<typeof LobeDeepSeekAnthropicAI>[0] = {}) {
  const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', ...options });
  const create = vi
    .spyOn(runtime['client'].messages, 'create')
    .mockImplementation(() => Promise.resolve(new ReadableStream()) as never);
  return { runtime, create };
}

const expectDeferredLoading = (body: any, headers: Record<string, string> | undefined) => {
  // The activated schema stays declared, deferred, so the opening prompt is unchanged.
  expect(body.tools).toMatchObject([
    { name: 'activateTools' },
    { name: 'readDocument', defer_loading: true },
  ]);
  expect(body.tools[0]).not.toHaveProperty('defer_loading');
  expect(body.messages.slice(-2)).toMatchObject([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'act1' }] },
    {
      role: 'system',
      content: [
        { type: 'text', text: 'docs' },
        { type: 'tool_addition', tool: { type: 'tool_reference', name: 'readDocument' } },
      ],
    },
  ]);
  expect(JSON.stringify(body)).not.toContain('tool_definition');
  expect(headers?.['anthropic-beta']).toBeUndefined();
};

describe('DeepSeek deferred tool loading', () => {
  it('loads the activated tool by reference and keeps system and initial tools stable', async () => {
    const { runtime, create } = capture();
    await runtime.chat(initial, { getToolActivationContext: async () => ({ additions: [] }) });
    await runtime.chat(next, { getToolActivationContext: async () => delta });

    const [first, second] = create.mock.calls.map(([body]) => body as any);
    expect(second.system).toEqual(first.system);
    expect(second.tools[0]).toEqual(first.tools[0]);
    expectDeferredLoading(second, create.mock.calls[1][1]?.headers as any);
  });

  it('keeps the ordinary payload for deepseek-v4-pro', async () => {
    const { runtime, create } = capture();
    const resolve = vi.fn(async () => delta);
    await runtime.chat(
      { ...next, model: 'deepseek-v4-pro' },
      { getToolActivationContext: resolve },
    );

    expect(resolve).not.toHaveBeenCalled();
    const [body] = create.mock.calls[0];
    expect(body.tools).toMatchObject([{ name: 'activateTools' }, { name: 'readDocument' }]);
    expect(JSON.stringify(body)).not.toContain('defer_loading');
    expect(body.system).toMatchObject([{ text: 'base + docs' }]);
  });

  it('keeps the ordinary payload on a relay until the channel opts in', async () => {
    const relay = capture({ baseURL: 'https://relay.example/anthropic' });
    const resolve = vi.fn(async () => delta);
    await relay.runtime.chat(next, { getToolActivationContext: resolve });
    expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(relay.create.mock.calls[0][0])).not.toContain('defer_loading');

    const optedIn = capture({
      baseURL: 'https://relay.example/anthropic',
      deferredToolLoading: true,
    } as any);
    await optedIn.runtime.chat(next, { getToolActivationContext: async () => delta });
    const [body, options] = optedIn.create.mock.calls[0];
    expectDeferredLoading(body, options?.headers as any);
  });

  it('turns deferred loading off through the env on the official endpoint', async () => {
    vi.stubEnv('DEEPSEEK_DEFERRED_TOOL_LOADING', '0');
    const { runtime, create } = capture();
    const resolve = vi.fn(async () => delta);
    await runtime.chat(next, { getToolActivationContext: resolve });

    expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('defer_loading');
  });

  it('falls back to the ordinary payload when the activation result is missing', async () => {
    const { runtime, create } = capture();
    await runtime.chat(
      { ...next, messages: next.messages.slice(0, -1) },
      { getToolActivationContext: async () => delta },
    );

    const [body] = create.mock.calls[0];
    expect(body.system).toMatchObject([{ text: 'base + docs' }]);
    expect(body.tools).toMatchObject([{ name: 'activateTools' }, { name: 'readDocument' }]);
    expect(JSON.stringify(body)).not.toContain('defer_loading');
  });
});
