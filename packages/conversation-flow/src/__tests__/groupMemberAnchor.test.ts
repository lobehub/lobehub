import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types';

/**
 * Server-side `executeAgentTasks` runs each member in an isolation thread and
 * writes one `role: 'tool'` completion anchor per member under the group tool
 * message. No assistant lists those anchors in `tools[]`, so they rendered as
 * duplicate orphan skill calls (each carrying the whole task list) right under
 * the still-running supervisor turn.
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
    content: '',
    createdAt,
    id,
    parentId,
    role,
    updatedAt: createdAt,
    ...extra,
  }) as Message;

const plugin = {
  apiName: 'executeAgentTasks',
  arguments: '{"tasks":[{"agentId":"pm"},{"agentId":"eng"}]}',
  identifier: 'lobe-group-management',
  type: 'builtin',
} as const;

const anchor = (index: number, extra: Partial<Message> = {}) =>
  message(`anchor-${index}`, 'tool', 'group-tool', 10 + index, {
    plugin: { ...plugin, id: `call_1::m${index}` } as Message['plugin'],
    pluginState: { status: 'pending' },
    tool_call_id: `call_1::m${index}`,
    ...extra,
  });

const conversation = (anchors: Message[], extra: Message[] = []): Message[] => [
  message('user', 'user', null, 1, { content: 'Plan the interview loop' }),
  message('supervisor', 'assistant', 'user', 2, {
    content: 'Splitting the work',
    metadata: { isSupervisor: true },
    tools: [{ ...plugin, id: 'call_1', result_msg_id: 'group-tool' }],
  }),
  message('group-tool', 'tool', 'supervisor', 3, {
    plugin: { ...plugin, id: 'call_1' } as Message['plugin'],
    pluginState: { expectedMembers: 2, status: 'pending' },
    tool_call_id: 'call_1',
  }),
  ...anchors,
  ...extra,
];

const toolIds = (messages: Message[]) => {
  const { flatList } = parse(messages);
  return flatList.filter((item) => item.role === 'tool').map((item) => item.id);
};

describe('group-member anchors', () => {
  it('hides marked anchors instead of rendering orphan tool calls', () => {
    const messages = conversation([
      anchor(0, { metadata: { groupMemberAnchor: { agentId: 'pm', index: 0 } } }),
      anchor(1, { metadata: { groupMemberAnchor: { agentId: 'eng', index: 1 } } }),
    ]);

    const { flatList } = parse(messages);

    expect(toolIds(messages)).toEqual([]);
    expect(flatList.map((item) => item.id)).toEqual(['user', 'supervisor']);
  });

  it('hides legacy anchors written before the marker', () => {
    expect(toolIds(conversation([anchor(0), anchor(1)]))).toEqual([]);
  });

  it('hides anchors once filled while the supervisor continues', () => {
    const messages = conversation(
      [
        anchor(0, { content: 'PM draft', pluginState: { status: 'completed' } }),
        anchor(1, { content: 'Eng bar', pluginState: { status: 'completed' } }),
      ],
      [message('summary', 'assistant', 'group-tool', 20, { content: 'Merged plan' })],
    );

    const { flatList } = parse(messages);

    expect(toolIds(messages)).toEqual([]);
    // The resumed reply still folds into the supervisor's turn.
    const blocks = (flatList.at(-1) as { children?: Array<{ id: string }> }).children ?? [];
    expect(blocks.map((block) => block.id)).toEqual(['supervisor', 'summary']);
  });

  // The legacy fallback only matches the suffix under a tool parent, so a real
  // tool call whose id happens to end in `::m0` still renders.
  it('keeps an assistant-owned tool row whose call id ends like an anchor', () => {
    const messages: Message[] = [
      message('user', 'user', null, 1),
      message('assistant', 'assistant', 'user', 2, { content: 'thinking' }),
      message('stray', 'tool', 'assistant', 3, { tool_call_id: 'x::m0' }),
    ];

    expect(toolIds(messages)).toEqual(['stray']);
  });
});
