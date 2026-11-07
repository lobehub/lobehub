import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { mcpActivityDeadline } from './mcpActivity';

const now = Date.now();
const tool = {
  role: 'tool',
  plugin: { type: 'mcp' },
  createdAt: now,
  content: '',
} as UIChatMessage;
describe('MCP activity polling boundary', () => {
  it('does not poll idle topics, completed tools, other plugins, or old abandoned calls', () => {
    for (const rows of [
      [],
      [{ ...tool, content: 'done' }],
      [{ ...tool, error: { message: 'failed' } }],
      [{ ...tool, plugin: { type: 'builtin' } }],
      [{ ...tool, createdAt: now - 180_001 }],
    ])
      expect(mcpActivityDeadline(rows as UIChatMessage[], now)).toBe(0);
  });
  it('bounds discovery to the active call and switches to the persisted interaction deadline', () => {
    expect(mcpActivityDeadline([tool], now)).toBe(now + 180_000);
    const pending = { ...tool, pluginState: { mcpElicitation: { deadline: now + 400 } } };
    expect(mcpActivityDeadline([pending], now)).toBe(now + 400);
    expect(mcpActivityDeadline([pending], now + 401)).toBe(0);
  });
  it('discovers server-streamed assistant calls before their durable tool row arrives', () => {
    const assistant = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: now,
      tools: [{ id: 'call_1', type: 'mcp' }],
    } as UIChatMessage;
    expect(mcpActivityDeadline([assistant], now)).toBe(now + 180_000);
    expect(
      mcpActivityDeadline(
        [assistant, { ...tool, parentId: assistant.id, tool_call_id: 'call_1', content: 'done' }],
        now,
      ),
    ).toBe(0);
  });
});

it('keeps discovery alive for a long native invocation until its actual persisted deadline', () => {
  const native = { ...tool, pluginState: { mcpInvocationDeadline: now + 600_000 } };
  expect(mcpActivityDeadline([native], now + 180_001)).toBe(now + 600_000);
  expect(mcpActivityDeadline([native], now + 600_001)).toBe(0);
  expect(mcpActivityDeadline([{ ...native, content: 'receipt' }], now)).toBe(0);
});
