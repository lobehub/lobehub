import { MessagesEngine } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { afterEach, expect, it, vi } from 'vitest';

import { buildDefaultAnthropicPayload } from '../../../../model-runtime/src/core/protocols/anthropicMessages/payload';

const withoutMarkers = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, child) =>
      key === 'cache_control'
        ? undefined
        : key === 'content' && typeof child === 'string'
          ? [{ type: 'text', text: child }]
          : child,
    ),
  );
afterEach(() => vi.useRealTimers());
it('serializes a date update after all parallel tool results and preserves earlier wire input', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T15:59:00Z'));
  const user = { id: 'u1', role: 'user', content: 'read both' } as UIChatMessage;
  const base = {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    systemRole: 'role',
    timezone: 'Asia/Singapore',
  };
  const first = await new MessagesEngine({
    ...base,
    messages: [user],
    contextReplay: { invocationId: 'a1' },
  }).process();
  const firstWire = await buildDefaultAnthropicPayload({
    model: base.model,
    messages: first.messages,
  });
  vi.setSystemTime(new Date('2026-11-25T16:01:00Z'));
  const assistant = {
    id: 'a1',
    role: 'assistant',
    content: '',
    metadata: { contextReplay: first.metadata.contextReplaySnapshot },
    tools: ['c1', 'c2'].map((id) => ({ id, identifier: 'tool', apiName: 'read', arguments: '{}' })),
  } as UIChatMessage;
  const second = await new MessagesEngine({
    ...base,
    contextReplay: { invocationId: 'a2' },
    messages: [
      user,
      assistant,
      ...['c1', 'c2'].map(
        (id) =>
          ({ id: `t_${id}`, role: 'tool', content: 'done', tool_call_id: id }) as UIChatMessage,
      ),
    ],
  }).process();
  const wire = await buildDefaultAnthropicPayload({ model: base.model, messages: second.messages });
  expect(withoutMarkers(wire.system)).toEqual(withoutMarkers(firstWire.system));
  expect(withoutMarkers(wire.messages.slice(0, firstWire.messages.length))).toEqual(
    withoutMarkers(firstWire.messages),
  );
  const results = wire.messages.find(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'tool_result'),
  )!;
  const blocks = results.content as Array<{ type: string; text?: string; tool_use_id?: string }>;
  expect(
    blocks.filter((part) => part.type === 'tool_result').map((part) => part.tool_use_id),
  ).toEqual(['c1', 'c2']);
  const dateMessageIndex = wire.messages.findIndex((message) =>
    JSON.stringify(message.content).includes('2026-11-26'),
  );
  expect(dateMessageIndex).toBeGreaterThan(wire.messages.indexOf(results));
});
