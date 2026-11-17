// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverSubSessionReceipt, renderSubSessionReceipt } from './receipt';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findLatestUserTurnHop: vi.fn(),
  findMessage: vi.fn(),
  findTopic: vi.fn(),
  getDisplay: vi.fn(),
  getLeaf: vi.fn(),
  labEnabled: vi.fn(),
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
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentDisplayFields: mocks.getDisplay };
  }),
}));
vi.mock('./labGate', () => ({ readSubSessionsEnabled: mocks.labEnabled }));

const db = { transaction: vi.fn(async (fn: any) => fn({ execute: vi.fn() })) } as any;

const child = {
  agentId: 'agt_codex',
  id: 'tpc_child',
  metadata: { openedBy: { agentId: 'agt_lobe', at: 'now', topicId: 'tpc_parent' } },
  title: 'Fix the flaky test',
  trigger: 'sub_session',
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

describe('deliverSubSessionReceipt', () => {
  const queueWakeup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child' ? child : id === 'tpc_parent' ? parent : undefined,
    );
    mocks.labEnabled.mockResolvedValue(true);
    mocks.findLatestUserTurnHop.mockResolvedValue(1);
    mocks.findMessage.mockResolvedValue(undefined);
    mocks.getLeaf.mockResolvedValue('leaf');
    mocks.getDisplay.mockResolvedValue({ avatar: '🤖', name: 'Codex', title: null });
    queueWakeup.mockResolvedValue(undefined);
  });

  it('lands a message from the sub-session on the opener and wakes it with the next hop', async () => {
    const outcome = await deliverSubSessionReceipt({ queueWakeup }, params);

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
          subSessionCallback: {
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
      'subsession-cb-op_child',
    );
    expect(queueWakeup).toHaveBeenCalledWith({
      agentId: 'agt_lobe',
      callbackMessageId: 'subsession-cb-op_child',
      originTopicId: 'tpc_parent',
      receiptId: 'subsession-cb-op_child',
    });
  });

  it('counts a turn a person started as hop 1', async () => {
    mocks.findLatestUserTurnHop.mockResolvedValue(undefined);

    await deliverSubSessionReceipt({ queueWakeup }, params);

    expect(mocks.create.mock.calls[0][0].metadata.agentSender.hop).toBe(1);
  });

  it('writes the receipt but does not wake the opener past the relay bound', async () => {
    mocks.findLatestUserTurnHop.mockResolvedValue(5);

    const outcome = await deliverSubSessionReceipt({ queueWakeup }, params);

    expect(outcome).toBe('hop_limit');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].metadata.agentSender.hop).toBe(6);
    expect(queueWakeup).not.toHaveBeenCalled();
  });

  it('sends nothing for a stopped turn', async () => {
    expect(
      await deliverSubSessionReceipt({ queueWakeup }, { ...params, reason: 'interrupted' }),
    ).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('sends nothing while the lab is off', async () => {
    mocks.labEnabled.mockResolvedValue(false);

    expect(await deliverSubSessionReceipt({ queueWakeup }, params)).toBe('lab_off');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('leaves task runs and detached sub-sessions alone', async () => {
    mocks.findTopic.mockResolvedValueOnce({ ...child, trigger: 'task' });
    expect(await deliverSubSessionReceipt({ queueWakeup }, params)).toBe('not_reportable');

    mocks.findTopic.mockResolvedValueOnce({
      ...child,
      metadata: { openedBy: { ...child.metadata.openedBy, detachedAt: 'later' } },
    });
    expect(await deliverSubSessionReceipt({ queueWakeup }, params)).toBe('not_reportable');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not report to an archived or missing opener', async () => {
    mocks.findTopic.mockImplementation(async (id: string) =>
      id === 'tpc_child' ? child : { ...parent, status: 'completed' },
    );
    expect(await deliverSubSessionReceipt({ queueWakeup }, params)).toBe('opener_gone');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('skips a receipt that was already written (redelivered completion), and its wake', async () => {
    mocks.findMessage.mockResolvedValue({ id: 'subsession-cb-op_child' });

    expect(await deliverSubSessionReceipt({ queueWakeup }, params)).toBe('duplicate');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(queueWakeup).not.toHaveBeenCalled();
  });
});

describe('renderSubSessionReceipt', () => {
  it('says why a failed turn stopped', () => {
    expect(renderSubSessionReceipt({ errorMessage: 'quota', reason: 'error' })).toBe(
      "The sub-session's turn failed.\n\nquota",
    );
  });

  it('has a body even without a reply', () => {
    expect(renderSubSessionReceipt({ reason: 'done' })).toBe(
      'The sub-session finished its turn without a reply.',
    );
  });
});
