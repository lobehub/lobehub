// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbandonOperationService } from '../AbandonOperationService';

/**
 * An abandoned run (its device or process went away) never reaches the
 * normal completion hooks that report a sub-topic's turn, so the watchdog's
 * finalize reports it to the parent itself — on both paths, with or without
 * coordinator state and run hooks.
 */
const mocks = vi.hoisted(() => ({
  abandonedSubTopic: vi.fn(),
  findOperation: vi.fn(),
  settleRunningOperation: vi.fn(),
}));

vi.mock('@/server/services/subTopic/settle', () => ({
  onAbandonedSubTopicRun: mocks.abandonedSubTopic,
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      create: vi.fn().mockResolvedValue({ id: 'msg_failure' }),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return {
      claimForAbandonment: vi.fn().mockResolvedValue(true),
      findById: mocks.findOperation,
      markAbandonmentFinalized: vi.fn().mockResolvedValue(undefined),
      markAbandonmentHandoffPending: vi.fn().mockResolvedValue(undefined),
      recordCompletion: vi.fn().mockResolvedValue(undefined),
      settleLive: vi.fn().mockResolvedValue(true),
    };
  }),
}));
vi.mock('../CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn(function () {
    return {
      completeOperation: vi.fn().mockResolvedValue(undefined),
      dispatchHooks: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return { findById: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { settleRunningOperation: mocks.settleRunningOperation };
  }),
}));

const buildStore = () => ({
  get: vi.fn(),
  getLatest: vi.fn(),
  list: vi.fn(),
  listPartials: vi.fn(),
  loadPartial: vi.fn().mockResolvedValue(null),
  removePartial: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  savePartial: vi.fn().mockResolvedValue(undefined),
});

const buildDb = (operationRow: any = null) =>
  ({
    query: {
      agentOperations: { findFirst: vi.fn().mockResolvedValue(operationRow) },
      messages: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  }) as any;

const abandon = (state: any, operationRow: any = null) =>
  new AbandonOperationService(buildDb(operationRow), {
    coordinator: {
      deleteAgentOperation: vi.fn().mockResolvedValue(undefined),
      loadAgentState: vi.fn().mockResolvedValue(state),
    } as any,
    snapshotStore: buildStore() as any,
  }).finalizeAbandoned('op_x', 'inactivity_watchdog');

const runningRow = (extra: Record<string, unknown> = {}) => ({
  agentId: 'agt_x',
  id: 'op_x',
  startedAt: new Date('2026-11-20T00:00:00.000Z'),
  status: 'running',
  topicId: 'tpc_x',
  userId: 'user_x',
  workspaceId: 'ws_x',
  ...extra,
});

const reported = {
  operationId: 'op_x',
  reason: 'inactivity_watchdog',
  topicId: 'tpc_x',
  userId: 'user_x',
  workspaceId: 'ws_x',
};

describe('AbandonOperationService — sub-topic report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOperation.mockResolvedValue(null);
    mocks.settleRunningOperation.mockResolvedValue({ status: 'settled' });
  });

  it('reports a run finalized with its coordinator state', async () => {
    await abandon({
      metadata: { assistantMessageId: 'msg_assist' },
      origin: { agentId: 'agt_x', topicId: 'tpc_x', userId: 'user_x', workspaceId: 'ws_x' },
      status: 'running',
    });

    expect(mocks.abandonedSubTopic).toHaveBeenCalledWith(expect.objectContaining(reported));
  });

  it('does not report a sub-agent run: its parent run resumes instead', async () => {
    await abandon({
      origin: { lineage: { isSubAgent: true }, threadId: 'thd_1', userId: 'user_x' },
      status: 'running',
    });

    expect(mocks.abandonedSubTopic).not.toHaveBeenCalled();
  });

  it('reports a run without state or hooks', async () => {
    await abandon(null, runningRow());

    expect(mocks.abandonedSubTopic).toHaveBeenCalledWith(expect.objectContaining(reported));
  });

  it('does not report a stateless child run, or a topic a newer run owns', async () => {
    await abandon(null, runningRow({ parentOperationId: 'op_parent' }));
    mocks.settleRunningOperation.mockResolvedValue({
      activeOperationId: 'op_newer',
      status: 'conflict',
    });
    await abandon(null, runningRow());

    expect(mocks.abandonedSubTopic).not.toHaveBeenCalled();
  });
});
