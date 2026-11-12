import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * The `enableStaleToolResultTrim` engine param gates the
 * StaleToolResultTrimProcessor: undefined / true trims (default), explicit
 * false leaves the history untouched.
 */

const READ_CONTENT = 'x'.repeat(120_000);

const assistantWithToolCall = (id: string, apiName: string, args: Record<string, unknown>) =>
  ({
    content: '',
    id,
    role: 'assistant',
    tools: [
      {
        apiName,
        arguments: JSON.stringify(args),
        id: `call-${apiName}`,
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
    ],
  }) as unknown as UIChatMessage;

const toolMessage = (
  apiName: string,
  content: string,
  pluginState: Record<string, unknown>,
  args: Record<string, unknown>,
): UIChatMessage =>
  ({
    content,
    id: `tool-${apiName}`,
    plugin: {
      apiName,
      arguments: JSON.stringify(args),
      identifier: 'lobe-local-system',
    },
    pluginState,
    role: 'tool',
    tool_call_id: `call-${apiName}`,
  }) as unknown as UIChatMessage;

// A readFile result superseded by a later write to the same path, pushed out
// of the default 20-message recency window and past the default 100k minimum
// tool-char gate so the trim fires by default.
const supersededReadMessages = (): UIChatMessage[] => [
  assistantWithToolCall('a1', 'readFile', { path: '/a.ts' }),
  toolMessage('readFile', READ_CONTENT, { loc: [0, 200], path: '/a.ts' }, { path: '/a.ts' }),
  assistantWithToolCall('a2', 'writeFile', { path: '/a.ts' }),
  toolMessage(
    'writeFile',
    'Successfully wrote to /a.ts',
    { path: '/a.ts', success: true },
    { path: '/a.ts' },
  ),
  ...Array.from(
    { length: 21 },
    (_, i) =>
      ({ content: `recent ${i}`, id: `pad-${i}`, role: 'assistant' }) as unknown as UIChatMessage,
  ),
];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages: [],
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
  ...overrides,
});

const payloadText = (messages: any[]) =>
  messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

describe('MessagesEngine — stale tool result trimming switch', () => {
  it('trims a superseded readFile result by default (param undefined)', async () => {
    const engine = new MessagesEngine(createParams({ messages: supersededReadMessages() }));

    const result = await engine.process();

    const payload = payloadText(result.messages);
    expect(payload).not.toContain(READ_CONTENT);
    expect(payload).toContain('superseded by a later write');
  });

  it('leaves the history untouched when enableStaleToolResultTrim is false', async () => {
    const engine = new MessagesEngine(
      createParams({ enableStaleToolResultTrim: false, messages: supersededReadMessages() }),
    );

    const result = await engine.process();

    const payload = payloadText(result.messages);
    expect(payload).toContain(READ_CONTENT);
    expect(payload).not.toContain('superseded by a later write');
  });
});

describe('MessagesEngine — prompt-cache TTL for the stale tool result trim', () => {
  const T0 = Date.parse('2026-11-10T08:00:00Z');
  const GAP = 30 * 60_000;

  // A 30-minute turn gap over a large live prefix: cold under Anthropic's
  // default 5m cache (the trim is free), warm under the opt-in 1h cache, where
  // rewriting the 500k prefix at the 2× write price cannot pay off.
  const turnAfterGap = (): UIChatMessage[] => [
    { content: 'z'.repeat(500_000), id: 'big-live-doc', role: 'assistant' } as UIChatMessage,
    ...supersededReadMessages(),
    {
      content: 'previous turn done',
      createdAt: T0,
      id: 'prev',
      role: 'assistant',
    } as UIChatMessage,
    { content: 'next task', createdAt: T0 + GAP, id: 'trigger', role: 'user' } as UIChatMessage,
  ];

  const anthropicParams = (overrides?: Partial<MessagesEngineParams>) =>
    createParams({
      messages: turnAfterGap(),
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      ...overrides,
    });

  it('treats the gap as cold and trims on the default 5m cache', async () => {
    const result = await new MessagesEngine(anthropicParams()).process();

    expect(payloadText(result.messages)).toContain('superseded by a later write');
  });

  it('keeps the warm prefix intact when the request writes 1h breakpoints', async () => {
    const result = await new MessagesEngine(anthropicParams({ contextCachingTTL: '1h' })).process();

    const payload = payloadText(result.messages);
    expect(payload).toContain(READ_CONTENT);
    expect(payload).not.toContain('superseded by a later write');
  });
});
