import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

const buildMessages = (toolParent: boolean): Message[] => {
  const message = (
    id: string,
    role: Message['role'],
    parentId: string | undefined,
    createdAt: number,
    extra: Partial<Message> = {},
  ): Message => ({
    agentId: role === 'user' ? undefined : 'member',
    content: id,
    createdAt,
    id,
    parentId,
    role,
    updatedAt: createdAt,
    ...extra,
  });
  return [
    message('request', 'user', undefined, 0),
    message('working', 'assistant', 'request', 10, {
      tools: [
        { apiName: 'run', arguments: '{}', id: 'call', identifier: 'shell', type: 'builtin' },
      ],
    }),
    message('interrupt', 'user', 'working', 20),
    message('tool-result', 'tool', 'working', 30, { tool_call_id: 'call' }),
    message('member-final', 'assistant', toolParent ? 'tool-result' : 'working', 40),
    message('supervisor-reply', 'assistant', 'interrupt', 50, { agentId: 'supervisor' }),
    message('next-user', 'user', 'supervisor-reply', 60),
  ];
};
const visibleIds = (messages: Message[]) => {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string') ids.add(record.id);
    if (typeof record.result_msg_id === 'string') ids.add(record.result_msg_id);
    Object.values(record).forEach(visit);
  };
  visit(parse(messages).flatList);
  return ids;
};
describe.each([true, false])('concurrent interruption (tool-parent=%s)', (toolParent) => {
  it('keeps the interruption and later turns visible after reloading the persisted tree', () => {
    const messages = buildMessages(toolParent);
    const original = structuredClone(messages);
    for (const input of [messages, structuredClone(messages)]) {
      const ids = visibleIds(input);
      for (const message of messages) expect(ids.has(message.id), message.id).toBe(true);
      expect(parse(input).flatList.at(-1)?.id).toBe('next-user');
    }
    expect(messages).toEqual(original);
  });
  it('does not recover a deliberate rewind made after the member finished', () => {
    const messages = buildMessages(toolParent).map((m) =>
      m.id === 'interrupt' ? { ...m, createdAt: 100 } : m,
    );
    expect(visibleIds(messages).has('interrupt')).toBe(false);
  });
  it('recovers an explicitly selected interruption and its descendants after reload', () => {
    const messages = buildMessages(toolParent).map((m) =>
      m.id === 'working' ? { ...m, metadata: { activeBranchIndex: 0 } } : m,
    );
    for (const input of [messages, structuredClone(messages)]) {
      const ids = visibleIds(input);
      for (const id of ['interrupt', 'supervisor-reply', 'next-user']) {
        expect(ids.has(id), id).toBe(true);
      }
      expect(parse(input).flatList.at(-1)?.id).toBe('next-user');
    }
  });
  it('does not recover an old interruption while a new branch is being created', () => {
    const messages = buildMessages(toolParent).map((m) =>
      m.id === 'working' ? { ...m, metadata: { activeBranchIndex: toolParent ? 1 : 2 } } : m,
    );
    const ids = visibleIds(messages);
    for (const id of ['interrupt', 'supervisor-reply', 'next-user']) {
      expect(ids.has(id), id).toBe(false);
    }
  });
  it('does not override an explicit branch selection', () => {
    const messages = buildMessages(toolParent).map((m) =>
      m.id === 'working' ? { ...m, metadata: { activeBranchIndex: 1 } } : m,
    );
    expect(visibleIds(messages).has('interrupt')).toBe(false);
  });
  it('does not recover thread replies into the main conversation', () => {
    const messages = buildMessages(toolParent).map((m) =>
      m.id === 'interrupt' ? { ...m, threadId: 'thread-1' } : m,
    );
    expect(visibleIds(messages).has('interrupt')).toBe(false);
  });
});
