// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverSubTopicReceipt, renderSubTopicReceipt } from './receipt';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findLatestUserTurnHop: vi.fn(),
  findMessage: vi.fn(),
  findOperation: vi.fn(),
  findTopic: vi.fn(),
  getDisplay: vi.fn(),
  getLeaf: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: mocks.findTopic };
  }),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      create: mocks.create,
      findById: mocks.findMessage,
      findLatestUserTurnHop: mocks.findLatestUserTurnHop,
      getLastMainThreadSpineMessageId: mocks.getLeaf,
    };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: mocks.findOperation };
  }),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentDisplayFields: mocks.getDisplay };
  }),
}));

const db = { transaction: vi.fn(async (fn: any) => fn({ execute: vi.fn() })) } as any;

const child = {
  agentId: 'agt_codex',
  id: 'tpc_child',
  metadata: { openedBy: { agentId: 'agt_lobe', at: 'now', topicId: 'tpc_parent' } },
  title: 'Fix the flaky test',
  trigger: 'sub_topic',
};
const parent = { agentId: 'agt_lobe', id: 'tpc_parent', status: 'active' };

const params = {
  db,
  lastAssistantContent: 'Fixed in commit abc.',
  operationId: 'op_child',
  reason: 'done',
  topicId: 'tpc_child',
  userId: 'user-1',
};

describe('deliverSubTopicReceipt', () => {
  const queueWakeup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // The settled run: a top-level operation of the sub-topic, by this caller.
    mocks.findOperation.mockResolvedValue({
      id: 'op_child',
      parentOperationId: null,
      topicId: 'tpc_child',
      userId: 'user-1',
    });
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child' ? child : id === 'tpc_parent' ? parent : undefined,
    );
    mocks.findLatestUserTurnHop.mockResolvedValue(1);
    mocks.findMessage.mockResolvedValue(undefined);
    mocks.getLeaf.mockResolvedValue('leaf');
    mocks.getDisplay.mockResolvedValue({ avatar: '🤖', name: 'Codex', title: null });
    queueWakeup.mockResolvedValue(undefined);
  });

  it('lands a message from the sub-topic on the opener and wakes it with the next hop', async () => {
    const outcome = await deliverSubTopicReceipt({ queueWakeup }, params);

    expect(outcome).toBe('delivered');
    expect(mocks.create).toHaveBeenCalledWith(
      {
        agentId: 'agt_lobe',
        content: 'Fixed in commit abc.',
        metadata: {
          agentSender: expect.objectContaining({
            agentId: 'agt_codex',
            hop: 2,
            name: 'Codex',
            topicAgentId: 'agt_codex',
            topicId: 'tpc_child',
            topicTitle: 'Fix the flaky test',
          }),
          subTopicCallback: {
            agentId: 'agt_codex',
            operationId: 'op_child',
            reason: 'done',
            title: 'Fix the flaky test',
            topicId: 'tpc_child',
          },
        },
        parentId: 'leaf',
        role: 'user',
        topicId: 'tpc_parent',
      },
      'subtopic-cb-op_child',
    );
    expect(queueWakeup).toHaveBeenCalledWith({
      agentId: 'agt_lobe',
      callbackMessageId: 'subtopic-cb-op_child',
      originTopicId: 'tpc_parent',
      receiptId: 'subtopic-cb-op_child',
    });
  });

  it('counts a turn a person started as hop 1', async () => {
    mocks.findLatestUserTurnHop.mockResolvedValue(undefined);

    await deliverSubTopicReceipt({ queueWakeup }, params);

    expect(mocks.create.mock.calls[0][0].metadata.agentSender.hop).toBe(1);
  });

  it('writes the receipt but does not wake the opener past the relay bound', async () => {
    mocks.findLatestUserTurnHop.mockResolvedValue(5);

    const outcome = await deliverSubTopicReceipt({ queueWakeup }, params);

    expect(outcome).toBe('hop_limit');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].metadata.agentSender.hop).toBe(6);
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('sends nothing for a stopped turn', async () => {
    expect(
      await deliverSubTopicReceipt({ queueWakeup }, { ...params, reason: 'interrupted' }),
    ).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports regardless of the Better Coding Experience lab', async () => {
    // No lab read at all: a sub-topic opened by `lh topic send --new` reports either way.
    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('delivered');
  });

  it('sends nothing for a topic opened detached (no link)', async () => {
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child' ? { ...child, metadata: {}, trigger: 'cli' } : parent,
    );

    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('sends nothing when the sub-topic was moved to the top level before its turn ended', async () => {
    // The link is read when the turn settles, so a detach mid-run already counts.
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child'
        ? {
            ...child,
            metadata: { openedBy: { ...child.metadata.openedBy, detachedAt: 'mid-run' } },
          }
        : parent,
    );

    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('leaves task runs and detached sub-topics alone', async () => {
    mocks.findTopic.mockResolvedValueOnce({ ...child, trigger: 'task' });
    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('not_reportable');

    mocks.findTopic.mockResolvedValueOnce({
      ...child,
      metadata: { openedBy: { ...child.metadata.openedBy, detachedAt: 'later' } },
    });
    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a made-up operation', undefined],
    ['a run of another topic', { parentOperationId: null, topicId: 'tpc_other', userId: 'user-1' }],
    ['a nested sub-run', { parentOperationId: 'op_root', topicId: 'tpc_child', userId: 'user-1' }],
    ["another member's run", { parentOperationId: null, topicId: 'tpc_child', userId: 'user-2' }],
  ])('reports nothing for %s (a forged settle signal)', async (_label, operation) => {
    mocks.findTopic.mockImplementation(async (id: string) => (id === 'tpc_child' ? child : parent));
    mocks.findOperation.mockResolvedValue(operation);

    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('does not report to an archived or missing opener', async () => {
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child' ? child : { ...parent, status: 'completed' },
    );
    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('opener_gone');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('skips a receipt that was already written (redelivered completion), and its wake', async () => {
    mocks.findMessage.mockResolvedValue({ id: 'subtopic-cb-op_child' });

    expect(await deliverSubTopicReceipt({ queueWakeup }, params)).toBe('duplicate');

    expect(mocks.create).not.toHaveBeenCalled();
    // Without the receipt queue a second wake would run twice.
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('queues the wake again on a redelivery when the queue makes that a no-op, repairing a lost enqueue', async () => {
    mocks.findMessage.mockResolvedValue({
      id: 'subtopic-cb-op_child',
      metadata: { agentSender: { hop: 2 } },
    });

    expect(await deliverSubTopicReceipt({ canQueue: () => true, queueWakeup }, params)).toBe(
      'duplicate',
    );

    expect(mocks.create).not.toHaveBeenCalled();
    expect(queueWakeup).toHaveBeenCalledWith({
      agentId: 'agt_lobe',
      callbackMessageId: 'subtopic-cb-op_child',
      originTopicId: 'tpc_parent',
      receiptId: 'subtopic-cb-op_child',
    });
  });

  it('keeps the hop bound on a redelivery, using the hop the receipt was written with', async () => {
    mocks.findMessage.mockResolvedValue({
      id: 'subtopic-cb-op_child',
      metadata: { agentSender: { hop: 6 } },
    });

    await deliverSubTopicReceipt({ canQueue: () => true, queueWakeup }, params);

    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('retries a failed enqueue once when the queue makes a retry safe', async () => {
    queueWakeup.mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);

    expect(await deliverSubTopicReceipt({ canQueue: () => true, queueWakeup }, params)).toBe(
      'delivered',
    );

    expect(queueWakeup).toHaveBeenCalledTimes(2);
  });
});

describe('renderSubTopicReceipt', () => {
  it('says why a failed turn stopped', () => {
    expect(renderSubTopicReceipt({ errorMessage: 'quota', reason: 'error' })).toBe(
      "The sub-topic's turn failed.\n\nquota",
    );
  });

  it('has a body even without a reply', () => {
    expect(renderSubTopicReceipt({ reason: 'done' })).toBe(
      'The sub-topic finished its turn without a reply.',
    );
  });
});
