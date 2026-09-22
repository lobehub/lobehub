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
