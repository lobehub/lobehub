import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

/**
 * Server-side `speak` parents the in-group member's reply to the SUPERVISOR
 * assistant that issued the call (a sibling of the tool result), while the
 * supervisor continues through the tool result. Once the supervisor resumes,
 * the speak turn becomes an intermediate step of the collected assistant
 * chain, and the member reply must still render (#19552).
 */
const message = (
  id: string,
  role: Message['role'],
  parentId: string | null,
  createdAt: number,
  extra: Partial<Message> = {},
): Message =>
  ({
    agentId: 'supervisor',
    content: id,
    createdAt,
    id,
    parentId,
    role,
    updatedAt: createdAt,
    ...extra,
  }) as Message;

const speakCall = (id: string, parentId: string, createdAt: number, resultId: string) =>
  message(id, 'assistant', parentId, createdAt, {
    metadata: { isSupervisor: true, orchestrationRole: 'supervisor' },
    tools: [
      {
        apiName: 'speak',
        arguments: '{"agentId":"member"}',
        id: `${id}-tool`,
        identifier: 'lobe-group-management',
        result_msg_id: resultId,
        type: 'builtin',
      },
    ],
  });

const memberReply = (
  id: string,
  parentId: string,
  createdAt: number,
  extra: Partial<Message> = {},
) =>
  message(id, 'assistant', parentId, createdAt, {
    agentId: 'member',
    content: 'SYNTHETIC_MEMBER_REPLY',
    metadata: { orchestrationRole: 'member' },
    ...extra,
  });

/** Fixture from the issue: user → speak call → (tool result → follow-up, member reply). */
const singleSpeak = (): Message[] => [
  message('user', 'user', null, 1),
  speakCall('supervisor-call', 'user', 2, 'tool-result'),
  message('tool-result', 'tool', 'supervisor-call', 3, {
    content: 'Member started',
    tool_call_id: 'supervisor-call-tool',
  }),
  memberReply('member-reply', 'supervisor-call', 4),
  message('supervisor-followup', 'assistant', 'tool-result', 5),
];

/** Same shape with an earlier supervisor tool step, so the speak turn is nested in the group. */
const nestedSpeak = (): Message[] => [
  message('user', 'user', null, 1),
  message('prep-call', 'assistant', 'user', 1.5, {
    tools: [
      {
        apiName: 'prepare',
        arguments: '{}',
        id: 'prep-tool',
        identifier: 'example',
        result_msg_id: 'prep-result',
        type: 'builtin',
      },
    ],
  }),
  message('prep-result', 'tool', 'prep-call', 2, { tool_call_id: 'prep-tool' }),
  speakCall('supervisor-call', 'prep-result', 4, 'tool-result'),
  message('tool-result', 'tool', 'supervisor-call', 5, { tool_call_id: 'supervisor-call-tool' }),
  memberReply('member-reply', 'supervisor-call', 6),
  message('supervisor-followup', 'assistant', 'tool-result', 7),
];

const countIds = (messages: Message[]) => {
  const counts = new Map<string, number>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string') counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
    Object.values(record).forEach(visit);
  };
  visit(parse(messages).flatList);
  return counts;
};

describe('group member reply under an intermediate speak call (#19552)', () => {
  it.each([
    ['single speak', singleSpeak],
    ['speak nested after an earlier tool step', nestedSpeak],
  ])('renders the member reply exactly once (%s)', (_, build) => {
    const messages = build();
    const original = structuredClone(messages);
    const result = parse(messages);

    expect(result.messageMap['member-reply']).toBeDefined();
    const counts = countIds(messages);
    expect(counts.get('member-reply')).toBe(1);
    // The supervisor chain stays intact inside its group.
    expect(counts.get('supervisor-call')).toBeGreaterThan(0);
    expect(counts.get('supervisor-followup')).toBe(1);
    expect(result.flatList.at(-1)?.id).toBe('member-reply');
    expect(messages).toEqual(original);
  });

  it('keeps the member reply when the supervisor has not resumed yet', () => {
    const messages = singleSpeak().filter((m) => m.id !== 'supervisor-followup');
    expect(countIds(messages).get('member-reply')).toBe(1);
  });

  it('renders a multi-step member run and the turn that follows it', () => {
    const messages: Message[] = [
      ...singleSpeak().map((m) =>
        m.id === 'member-reply'
          ? memberReply('member-reply', 'supervisor-call', 4, {
              tools: [
                {
                  apiName: 'search',
                  arguments: '{}',
                  id: 'member-tool',
                  identifier: 'web',
                  result_msg_id: 'member-tool-result',
                  type: 'builtin',
                },
              ],
            })
          : m,
      ),
      message('member-tool-result', 'tool', 'member-reply', 4.5, {
        agentId: 'member',
        tool_call_id: 'member-tool',
      }),
      memberReply('member-final', 'member-tool-result', 4.8),
      message('next-user', 'user', 'supervisor-followup', 6),
    ];
    const counts = countIds(messages);
    for (const id of ['member-tool-result', 'member-final', 'next-user']) {
      expect(counts.get(id), id).toBe(1);
    }
    // The member's own tool run renders as one group (keyed by its first step),
    // before the user's next message rather than after it.
    expect(parse(messages).flatList.map((m) => m.id)).toEqual([
      'user',
      'supervisor-call',
      'member-reply',
      'next-user',
    ]);
  });

  it('does not surface a regenerated supervisor branch under the speak call', () => {
    const messages = [
      ...singleSpeak(),
      message('supervisor-retry', 'assistant', 'supervisor-call', 4.5),
    ];
    const counts = countIds(messages);
    expect(counts.get('member-reply')).toBe(1);
    expect(counts.has('supervisor-retry')).toBe(false);
  });

  it('does not pull an isolated (threaded) member run into the main transcript', () => {
    const messages = singleSpeak().map((m) =>
      m.id === 'member-reply' ? { ...m, threadId: 'thread-1' } : m,
    );
    expect(countIds(messages).has('member-reply')).toBe(false);
  });
});
