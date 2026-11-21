// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotifyAgentInterventionRequiredParams } from '@/business/server/agent-run/agentInterventionReview';
import { WorkModel } from '@/database/models/work';
import type * as WorkRegistrationModule from '@/server/services/workRegistration';
import { registerWorksForOperation } from '@/server/services/workRegistration';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle, CriticalAgentInterventionPersistenceError } from '.';
import {
  mockBuildRuntimeInterventionNotification,
  mockListWorks,
  mockNotifyAgentInterventionRequired,
} from './testUtils';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  // Keep the real scope resolver: it is pure, and the share-visitor test
  // asserts the scope it derives reaches both the scan and the anchor lookup.
  ...(await importOriginal<typeof WorkRegistrationModule>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.dispatchHooks — parks do not register file works', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildRuntimeInterventionNotification.mockReset();
    mockBuildRuntimeInterventionNotification.mockResolvedValue(undefined);
    mockNotifyAgentInterventionRequired.mockReset();
    mockNotifyAgentInterventionRequired.mockResolvedValue(undefined);
  });

  const pendingNotification: NotifyAgentInterventionRequiredParams = {
    approvalMode: 'manual' as const,
    batch: {
      activityKey: '4369e854-719f-5301-bfa4-1f0742eec6ac',
      allowedActions: ['approve_tool', 'reject_continue', 'stop'],
      id: 'batch-1',
      kind: 'single' as const,
      sealed: true as const,
      stepIndex: 3,
    },
    context: {
      assistantMessageId: 'assistant-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    },
    items: [
      {
        allowedActions: ['approve_tool', 'reject_continue', 'stop'],
        interactionKind: 'tool_approval' as const,
        requestRevision: { hash: 'a'.repeat(64), version: 0 },
        sourceRef: {
          toolCallId: 'call-1',
          toolMessageId: 'tool-1',
          type: 'runtime' as const,
        },
        summary: 'Run command',
        surface: 'binary' as const,
      },
    ],
    summary: 'Approval required',
    systemActionEligibility: 'safe_single_binary' as const,
    userId: 'user-1',
  };

  const stubDurablePendingRows = (lifecycle: CompletionLifecycle) => {
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockResolvedValue({
        id: 'tool-1',
        parentId: 'assistant-1',
        role: 'tool',
        topicId: 'topic-1',
      }),
      findMessagePlugin: vi.fn().mockResolvedValue({
        intervention: {
          batchId: 'batch-1',
          itemIndex: 0,
          operationId: 'op-1',
          status: 'pending',
          stepIndex: 3,
        },
        toolCallId: 'call-1',
      }),
    };
  };

  it('publishes Review only after operation and every sealed batch row are durable', async () => {
    const lifecycle = buildLifecycle();
    const order: string[] = [];
    vi.spyOn(lifecycle as any, 'persistCompletion').mockImplementation(async () => {
      order.push('persist-operation');
      return true;
    });
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockImplementation(async () => {
      order.push('notify');
    });
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockImplementation(async () => {
        order.push('read-message');
        return {
          id: 'tool-1',
          parentId: 'assistant-1',
          role: 'tool',
          topicId: 'topic-1',
        };
      }),
      findMessagePlugin: vi.fn().mockImplementation(async () => {
        order.push('read-plugin');
        return {
          intervention: {
            batchId: 'batch-1',
            itemIndex: 0,
            operationId: 'op-1',
            status: 'pending',
            stepIndex: 3,
          },
          toolCallId: 'call-1',
        };
      }),
    };
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks(
      'op-1',
      { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'waiting_for_human' },
      'waiting_for_human',
    );

    expect(mockNotifyAgentInterventionRequired).toHaveBeenCalledWith(pendingNotification);
    expect(order[0]).toBe('persist-operation');
    expect(order.at(-1)).toBe('notify');
  });

  it('fails the parked lifecycle when one row is outside the sealed batch', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    (lifecycle as any).messageModel = {
      findById: vi.fn().mockResolvedValue({
        id: 'tool-1',
        parentId: 'assistant-1',
        role: 'tool',
        topicId: 'topic-1',
      }),
      findMessagePlugin: vi.fn().mockResolvedValue({
        intervention: {
          batchId: 'late-batch',
          itemIndex: 0,
          operationId: 'op-1',
          status: 'pending',
          stepIndex: 3,
        },
        toolCallId: 'call-1',
      }),
    };
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).rejects.toBeInstanceOf(CriticalAgentInterventionPersistenceError);

    expect(mockNotifyAgentInterventionRequired).not.toHaveBeenCalled();
  });

  it('propagates a durable Review create failure so the parked lifecycle can retry', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockRejectedValueOnce(new Error('database unavailable'));
    stubDurablePendingRows(lifecycle);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregister = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'database unavailable' }),
      name: 'CriticalAgentInterventionPersistenceError',
    });

    expect(hookDispatcher.dispatch).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('continues after post-create push fanout fails inside the business slot', async () => {
    const lifecycle = buildLifecycle();
    const pushFanout = vi.fn().mockRejectedValue(new Error('APNs unavailable'));
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(true);
    mockBuildRuntimeInterventionNotification.mockResolvedValue(pendingNotification);
    mockNotifyAgentInterventionRequired.mockImplementation(async () => {
      // Cloud owns this boundary: the generic row is already durable here, so
      // downstream delivery is best-effort and must not reject the slot.
      await pushFanout().catch(() => undefined);
    });
    stubDurablePendingRows(lifecycle);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'waiting_for_human' },
        'waiting_for_human',
      ),
    ).resolves.toBeUndefined();

    expect(pushFanout).toHaveBeenCalledOnce();
    expect(hookDispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it('does not build a Review when the parked operation persistence loses its CAS', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(false);

    await lifecycle.dispatchHooks(
      'op-1',
      { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'waiting_for_human' },
      'waiting_for_human',
    );

    expect(mockBuildRuntimeInterventionNotification).not.toHaveBeenCalled();
    expect(mockNotifyAgentInterventionRequired).not.toHaveBeenCalled();
  });

  // Regression: the park is not a completed deliverable boundary. The fresh
  // continuation sees the complete history and performs the terminal scan;
  // registering here would freeze pre-approval file content too early.
  it('does NOT register on a human-approval park before its continuation', async () => {
    const mockRegister = vi.mocked(registerWorksForOperation);
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    const parkedState = {
      host: { hooks: [] },
      origin: { agentId: 'a' },
      status: 'waiting_for_human',
    };
    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_human');

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('does NOT register on an async-tool park (same op resumes and registers later)', async () => {
    const mockRegister = vi.mocked(registerWorksForOperation);
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);

    const parkedState = {
      host: { hooks: [] },
      origin: { agentId: 'a' },
      status: 'waiting_for_async_tool',
    };
    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_async_tool');

    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.registerFileWorks', () => {
  const mockRegister = vi.mocked(registerWorksForOperation);
  beforeEach(() => {
    mockListWorks.mockReset();
  });

  it('anchors an already registered Work after a folded tool turn with no file scan candidates', async () => {
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    mockListWorks.mockResolvedValue([{ id: 'registered-document' }]);
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValue({ success: true });
    const state = {
      messages: [{ id: 'display-group', role: 'assistantGroup', children: [] }],
      metadata: { workAssistantMessageId: 'final-assistant' },
      origin: { sourceMessageId: 'source-user' },
    };

    await lifecycle.registerFileWorks('op-1', state);

    expect(mockListWorks).toHaveBeenCalledWith({
      includeFileWorks: true,
      limit: 1,
      rootOperationId: 'op-1',
    });
    expect(update).toHaveBeenCalledWith('final-assistant', {
      metadata: { work: { rootOperationId: 'op-1', userMessageId: 'source-user' } },
    });
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
  });

  it('does not anchor a reply when only other operations have Works', async () => {
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValue({ success: true });

    await lifecycle.registerFileWorks('op-1', {
      metadata: { assistantMessageId: 'final-assistant' },
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('withholds the completion marker when an anchor write fails and retries it', async () => {
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    mockListWorks.mockResolvedValue([{ id: 'registered-document' }]);
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    const state = { metadata: { assistantMessageId: 'final-assistant' } };
    await lifecycle.registerFileWorks('op-1', state);
    expect(state.metadata).not.toHaveProperty('_fileWorksRegistered');
    await lifecycle.registerFileWorks('op-1', state);
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('keeps registration retryable until the explicit final assistant id is available', async () => {
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    mockListWorks.mockResolvedValue([{ id: 'registered-document' }]);
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValue({ success: true });
    const state: { metadata: { assistantMessageId?: string } } = { metadata: {} };
    await lifecycle.registerFileWorks('op-1', state);
    expect(update).not.toHaveBeenCalled();
    expect(state.metadata).not.toHaveProperty('_fileWorksRegistered');
    state.metadata.assistantMessageId = 'final-assistant';
    await lifecycle.registerFileWorks('op-1', state);
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
  });

  it('preserves completion idempotency when the shell scanner resolved a fallback anchor', async () => {
    mockRegister.mockResolvedValue({ anchorMessageId: 'shell-assistant', attempted: 1, failed: 0 });
    mockListWorks.mockResolvedValue([{ id: 'registered-shell-work' }]);
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValue({ success: true });
    const state = { metadata: {} };
    await lifecycle.registerFileWorks('op-1', state);
    expect(update).toHaveBeenCalledWith('shell-assistant', {
      metadata: { work: { rootOperationId: 'op-1', userMessageId: undefined } },
    });
    expect(state.metadata).toHaveProperty('_fileWorksRegistered', true);
    mockRegister.mockClear();
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('registers once and stamps the state marker so later calls skip', async () => {
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 1, failed: 0 });
    const lifecycle = buildLifecycle();
    const state = {
      cost: { total: 1.25 },
      metadata: {},
      origin: { userId: 'user-2' },
      usage: { llm: { apiCalls: 2 } },
    } as any;

    await lifecycle.registerFileWorks('op-1', state);

    expect(mockRegister).toHaveBeenCalledTimes(1);
    // The terminal state's live totals ride along: on the pre-snapshot path the
    // op row's cost/usage columns are not persisted yet.
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        finalCost: { total: 1.25 },
        finalUsage: { llm: { apiCalls: 2 } },
        operationId: 'op-1',
        userId: 'user-2',
      }),
    );
    expect(state.metadata._fileWorksRegistered).toBe(true);

    // The dispatchHooks backstop receives the same state later in the request —
    // the marker must make that second call a no-op (no duplicate scan/export).
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('never throws and leaves the marker unset on failure so a later call retries', async () => {
    mockRegister.mockClear();
    mockRegister.mockRejectedValueOnce(new Error('sandbox export failed'));
    const lifecycle = buildLifecycle();
    const state = { metadata: {} } as any;

    await expect(lifecycle.registerFileWorks('op-1', state)).resolves.toBeUndefined();
    expect(state.metadata._fileWorksRegistered).toBeUndefined();

    mockRegister.mockResolvedValueOnce({ attempted: 1, failed: 0 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(state.metadata._fileWorksRegistered).toBe(true);
  });

  it('leaves the marker unset on a PARTIAL failure, then stamps it once all files land', async () => {
    // Regression: registerWorksForOperation swallows per-file failures and
    // never rejects, so a partial failure resolves normally. The marker must be
    // gated on the outcome (`failed === 0`), NOT stamped unconditionally — else
    // the dispatchHooks backstop skips the retry and the user gets neither a Work
    // nor the edited-files fallback card for the file that failed to export.
    mockRegister.mockClear();
    const lifecycle = buildLifecycle();
    const state = { metadata: {} } as any;

    // One of two files failed to export/register this round.
    mockRegister.mockResolvedValueOnce({ attempted: 2, failed: 1 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(state.metadata._fileWorksRegistered).toBeUndefined();

    // The backstop retries; the previously-registered file short-circuits on the
    // DB probe and the failed one now lands → failed=0 → marker set.
    mockRegister.mockResolvedValueOnce({ attempted: 2, failed: 0 });
    await lifecycle.registerFileWorks('op-1', state);
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(state.metadata._fileWorksRegistered).toBe(true);
  });

  it('tolerates a state without metadata', async () => {
    mockRegister.mockClear();
    mockRegister.mockResolvedValue({ attempted: 0, failed: 0 });
    const lifecycle = buildLifecycle();

    await expect(lifecycle.registerFileWorks('op-1', {} as any)).resolves.toBeUndefined();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('registers and anchors a share visitor run under its visitor-topic share scope', async () => {
    mockRegister.mockClear();
    vi.mocked(WorkModel).mockClear();
    mockRegister.mockResolvedValue({ attempted: 1, failed: 0 });
    mockListWorks.mockResolvedValue([{ id: 'visitor-file-work' }]);
    const lifecycle = buildLifecycle();
    const update = vi
      .spyOn(lifecycle['messageModel'], 'update')
      .mockResolvedValue({ success: true });
    const shareVisitor = { agentId: 'agt_1', shareId: 'share-1', visitorUserId: 'visitor-1' };
    const state = {
      metadata: { workAssistantMessageId: 'final-assistant' },
      origin: { sourceMessageId: 'source-user', topicId: 'tpc_visitor', userId: 'user-1' },
      principal: { actor: { shareVisitor } },
    };

    await lifecycle.registerFileWorks('op-1', state);

    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ agentShareVisitor: shareVisitor, operationId: 'op-1' }),
    );
    // The anchor lookup must read through the SAME scope the scan wrote under,
    // or the visitor's Work is never found and the chip never renders.
    expect(vi.mocked(WorkModel)).toHaveBeenCalledWith(expect.anything(), 'user-1', undefined, {
      shareId: 'share-1',
      topicId: 'tpc_visitor',
      type: 'agentShare',
      visitorUserId: 'visitor-1',
    });
    expect(update).toHaveBeenCalledWith('final-assistant', {
      metadata: { work: { rootOperationId: 'op-1', userMessageId: 'source-user' } },
    });
  });

  it('skips a share visitor run that has no topic instead of registering unscoped', async () => {
    mockRegister.mockClear();
    const lifecycle = buildLifecycle();
    const state = {
      metadata: {},
      origin: { userId: 'user-1' },
      principal: { actor: { shareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' } } },
    };

    await expect(lifecycle.registerFileWorks('op-1', state)).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(state.metadata).not.toHaveProperty('_fileWorksRegistered');
  });
});
