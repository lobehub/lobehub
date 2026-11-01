import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationMessage } from '../resolveUserMessageParentId';
import { resolveUserMessageParentId, selectBranchOfMessage } from '../resolveUserMessageParentId';

const messageModel = {
  findById: vi.fn(),
  getLatestNonToolMessageId: vi.fn(),
  getLatestSpineMessageId: vi.fn(),
  updateMetadata: vi.fn(),
};

const msg = (
  id: string,
  role: string,
  parentId: string | null,
  minute: number,
  extra: Partial<ConversationMessage> = {},
): ConversationMessage =>
  ({
    content: id,
    createdAt: new Date(Date.UTC(2026, 9, 14, 12, minute)),
    id,
    parentId,
    role,
    threadId: null,
    topicId: 'tpc_1',
    updatedAt: new Date(Date.UTC(2026, 9, 14, 12, minute)),
    ...extra,
  }) as ConversationMessage;

/**
 * u1 was answered by a1, then regenerated into a2 (newest row). The switcher on
 * u1 selects `activeBranchIndex`.
 */
const regenerated = (activeBranchIndex: number) => [
  msg('u1', 'user', null, 1, { metadata: { activeBranchIndex } }),
  msg('a1', 'assistant', 'u1', 2),
  msg('a2', 'assistant', 'u1', 3),
];

const resolve = (messages: ConversationMessage[], clientParentId?: string) =>
  resolveUserMessageParentId(messageModel as any, {
    clientParentId,
    messages,
    threadId: null,
    topicId: 'tpc_1',
  });

describe('resolveUserMessageParentId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageModel.findById.mockResolvedValue(undefined);
    messageModel.getLatestSpineMessageId.mockResolvedValue(undefined);
    messageModel.getLatestNonToolMessageId.mockResolvedValue(undefined);
  });

  it('continues the earlier reply the switcher selects, not the newest regenerated one', async () => {
    // The newest row a2 is on the branch the user switched away from.
    await expect(resolve(regenerated(0))).resolves.toBe('a1');
    await expect(resolve(regenerated(0), 'a1')).resolves.toBe('a1');
  });

  it('continues the newest reply when it is the selected one', async () => {
    await expect(resolve(regenerated(1))).resolves.toBe('a2');
  });

  it('keeps the client tail when the switch to it is not persisted yet', async () => {
    // The stored selection still points at a2, but the user already sees a1.
    await expect(resolve(regenerated(1), 'a1')).resolves.toBe('a1');
  });

  it('advances a stale client tail along the selected branch', async () => {
    // Another device continued a1 while this client still rendered a1 as tail.
    const messages = [
      ...regenerated(0),
      msg('u2', 'user', 'a1', 4),
      msg('a3', 'assistant', 'u2', 5),
    ];

    await expect(resolve(messages, 'a1')).resolves.toBe('a3');
  });

  it('does not advance into a newer turn on a hidden branch', async () => {
    const messages = [
      ...regenerated(0),
      msg('u3', 'user', 'a2', 4),
      msg('a4', 'assistant', 'u3', 5),
    ];

    await expect(resolve(messages, 'a1')).resolves.toBe('a1');
    await expect(resolve(messages)).resolves.toBe('a1');
  });

  it('keeps the query order when a turn and its reply share a millisecond', async () => {
    // The DB orders by microsecond createdAt; JS Dates collapse u2 and a2 into
    // one millisecond, and the reply must still win over its own user row.
    const messages = [
      msg('u1', 'user', null, 1),
      msg('a1', 'assistant', 'u1', 2),
      msg('u2', 'user', 'a1', 3),
      msg('a2', 'assistant', 'u2', 3),
    ];

    await expect(resolve(messages)).resolves.toBe('a2');
  });

  it('parents off the assistant that owns a tool-result tail', async () => {
    const messages = [
      msg('u1', 'user', null, 1),
      msg('a1', 'assistant', 'u1', 2, {
        tools: [
          { apiName: 'run', arguments: '{}', id: 'call_1', identifier: 'demo', type: 'default' },
        ] as any,
      }),
      msg('t1', 'tool', 'a1', 3, { tool_call_id: 'call_1' } as any),
    ];

    await expect(resolve(messages, 't1')).resolves.toBe('a1');
    await expect(resolve(messages)).resolves.toBe('a1');
  });

  it('skips a toolless signal turn as the conversation head', async () => {
    const messages = [
      msg('u1', 'user', null, 1),
      msg('a1', 'assistant', 'u1', 2),
      msg('s1', 'assistant', 'a1', 3, { metadata: { signal: { type: 'feedback' } } as any }),
    ];

    await expect(resolve(messages)).resolves.toBe('a1');
  });

  it('never returns the id of a synthetic message-group row', async () => {
    // `MessageModel.query` folds groups into rows keyed by the group id, which is
    // not a `messages` row and would break the parentId foreign key.
    const compare = msg('mg_compare', 'compareGroup', null, 3, {
      children: [{ id: 'col_1' }, { id: 'col_2' }],
    } as any);
    await expect(
      resolve([msg('u1', 'user', null, 1, { metadata: { compare: true } } as any), compare]),
    ).resolves.toBe('col_2');
    await expect(
      resolve(
        [msg('u1', 'user', null, 1, { metadata: { compare: true } } as any), compare],
        'mg_compare',
      ),
    ).resolves.toBe('col_2');

    const compressed = msg('mg_compressed', 'compressedGroup', null, 1, {
      lastMessageId: 'msg_last_compressed',
    } as any);
    await expect(resolve([compressed])).resolves.toBe('msg_last_compressed');
  });

  it('ignores a client tail from another topic or thread', async () => {
    messageModel.findById.mockResolvedValueOnce({ id: 'foreign', topicId: 'tpc_other' });

    await expect(resolve(regenerated(0), 'foreign')).resolves.toBe('a1');
  });

  it('keeps the spine fallbacks when the conversation could not be loaded', async () => {
    messageModel.getLatestSpineMessageId.mockResolvedValueOnce('msg_spine');
    await expect(resolve([])).resolves.toBe('msg_spine');

    messageModel.getLatestNonToolMessageId.mockResolvedValueOnce('msg_signal');
    await expect(resolve([])).resolves.toBe('msg_signal');
  });
});

describe('selectBranchOfMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const select = (messages: ConversationMessage[], message: ConversationMessage) =>
    selectBranchOfMessage(messageModel as any, { message, messages, threadId: null });

  it('switches the stored selection to the branch that received the turn', async () => {
    // The turn went under a1 while u1 still selects a2 (unsaved switch / other tab).
    await select(regenerated(1), msg('u2', 'user', 'a1', 4));

    expect(messageModel.updateMetadata).toHaveBeenCalledTimes(1);
    expect(messageModel.updateMetadata).toHaveBeenCalledWith('u1', { activeBranchIndex: 0 });
  });

  it('updates every branch point on the path', async () => {
    const messages = [
      msg('u1', 'user', null, 1, { metadata: { activeBranchIndex: 1 } }),
      msg('a1', 'assistant', 'u1', 2),
      msg('a2', 'assistant', 'u1', 3),
      msg('u2', 'user', 'a1', 4),
      msg('b1', 'assistant', 'u2', 5),
      msg('b2', 'assistant', 'u2', 6),
    ];
    // u2 was never switched explicitly; its newest-user fallback would not pick b1.
    messages[3] = msg('u2', 'user', 'a1', 4, { metadata: { activeBranchIndex: 1 } });

    await select(messages, msg('u3', 'user', 'b1', 7));

    expect(messageModel.updateMetadata).toHaveBeenCalledWith('u1', { activeBranchIndex: 0 });
    expect(messageModel.updateMetadata).toHaveBeenCalledWith('u2', { activeBranchIndex: 0 });
  });

  it('leaves the selection alone when the turn is already on the selected branch', async () => {
    await select(regenerated(0), msg('u2', 'user', 'a1', 4));
    await select(
      [msg('u1', 'user', null, 1), msg('a1', 'assistant', 'u1', 2)],
      msg('u2', 'user', 'a1', 3),
    );

    expect(messageModel.updateMetadata).not.toHaveBeenCalled();
  });
});
