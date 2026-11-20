// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeToolCall, releaseHeteroSteers, settleAgentRunFee } = vi.hoisted(() => ({
  executeToolCall: vi.fn(),
  releaseHeteroSteers: vi.fn(async () => {}),
  settleAgentRunFee: vi.fn(async () => {}),
}));

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { executeToolCall } }));
vi.mock('@/business/server/agent-run/runFee', () => ({ settleAgentRunFee }));
vi.mock('../steerQueue/hetero', () => ({ releaseHeteroSteers }));
vi.mock('@/server/services/agentRuntime/AbandonOperationService', () => ({
  AbandonOperationService: vi.fn(),
}));

// eslint-disable-next-line import/first
import { InterventionController } from './InterventionController';

const OPERATION_ID = 'op_running';
const TOPIC_ID = 'tpc_topic';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const createController = (operation: Record<string, unknown> = {}) => {
  const deps = {
    agentOperationModel: {
      findById: vi.fn(async () => ({ createdAt: new Date(), id: OPERATION_ID, ...operation })),
      settleDisconnectedRunner: vi.fn(async () => true),
      settleRunning: vi.fn(async () => true),
      settleStaleRunning: vi.fn(async () => true),
    },
    agentRuntimeService: { interruptOperation: vi.fn(async () => false) },
    db: {},
    finalizeAbandonedRun: vi.fn(async () => ({})),
    messageModel: {},
    resolveDeviceWorkspaceId: vi.fn(async () => undefined),
    threadModel: { findById: vi.fn(), update: vi.fn() },
    topicModel: {
      findById: vi.fn(async () => ({
        id: TOPIC_ID,
        metadata: {
          runningOperation: {
            deviceId: 'device_1',
            heteroType: 'claude-code',
            operationId: OPERATION_ID,
          },
        },
      })),
      settleRunningOperation: vi.fn(async () => true),
    },
    userId: 'user_1',
  };

  return { controller: new InterventionController(deps as any), deps };
};

describe('InterventionController.interruptTask', () => {
  beforeEach(() => {
    executeToolCall.mockReset();
    releaseHeteroSteers.mockReset();
    releaseHeteroSteers.mockImplementation(async () => {});
    settleAgentRunFee.mockClear();
  });

  it('returns the follow-ups a stopped device CLI run never picked up', async () => {
    executeToolCall.mockResolvedValue({ state: { exited: true }, success: true });
    const { controller, deps } = createController();

    const result = await controller.interruptTask({
      operationId: OPERATION_ID,
      topicId: TOPIC_ID,
    });

    expect(result).toMatchObject({ deviceCancellationConfirmed: true, success: true });
    expect(deps.agentOperationModel.settleRunning).toHaveBeenCalledWith(
      OPERATION_ID,
      'interrupted',
    );
    expect(releaseHeteroSteers).toHaveBeenCalledWith(OPERATION_ID);
  });

  it('keeps the follow-ups held while the device has not confirmed the exit', async () => {
    executeToolCall.mockResolvedValue({ state: { exited: false }, success: true });
    const { controller } = createController();

    const result = await controller.interruptTask({
      operationId: OPERATION_ID,
      topicId: TOPIC_ID,
    });

    expect(result).toMatchObject({ deviceCancellationConfirmed: false, success: false });
    expect(releaseHeteroSteers).not.toHaveBeenCalled();
  });

  it('still confirms the stop when returning the follow-ups fails', async () => {
    executeToolCall.mockResolvedValue({ state: { exited: true }, success: true });
    releaseHeteroSteers.mockRejectedValue(new Error('redis down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = createController();

    const result = await controller.interruptTask({
      operationId: OPERATION_ID,
      topicId: TOPIC_ID,
    });

    expect(result).toMatchObject({ deviceCancellationConfirmed: true, success: true });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe('when the run has no runner left (T-14643)', () => {
    /** A `running` row whose last ingest batch landed `minutes` ago. */
    const quietRun = (minutes: number) => ({
      createdAt: minutesAgo(minutes + 5),
      status: 'running',
      updatedAt: minutesAgo(minutes),
    });
    const offline = {
      content: 'Device is offline',
      error: 'DEVICE_OFFLINE',
      errorData: { code: 'DEVICE_OFFLINE' },
      success: false,
    };

    it('settles a quiet run whose device is offline as runner_disconnected', async () => {
      // The desktop app was closed: the cancel never reaches a client, and the
      // run had reported nothing for minutes.
      executeToolCall.mockResolvedValue(offline);
      const { controller, deps } = createController(quietRun(8));
      const before = Date.now();

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toEqual({
        completionReason: 'runner_disconnected',
        operationId: OPERATION_ID,
        success: true,
        threadId: undefined,
      });
      const [id, staleBefore] = deps.agentOperationModel.settleDisconnectedRunner.mock
        .calls[0] as unknown as [string, Date];
      expect(id).toBe(OPERATION_ID);
      // The claim re-checks the lease: a batch landing meanwhile wins.
      expect(staleBefore.getTime()).toBeLessThanOrEqual(before - 2 * 60_000 + 5);
      expect(deps.finalizeAbandonedRun).toHaveBeenCalledWith(OPERATION_ID, 'runner_disconnected');
      expect(releaseHeteroSteers).toHaveBeenCalledWith(OPERATION_ID);
      // Not a confirmed stop: the abandon path owns the topic and the fee.
      expect(deps.agentOperationModel.settleRunning).not.toHaveBeenCalled();
      expect(settleAgentRunFee).not.toHaveBeenCalled();
    });

    it('settles a quiet run the reconnected runner no longer holds', async () => {
      // The device came back on a new connection (desktop relaunch, `lh
      // connect` restart) and answers that it has no such task.
      executeToolCall.mockResolvedValue({
        content: '{"message":"No task found with taskId: op_running","success":false}',
        state: { message: `No task found with taskId: ${OPERATION_ID}`, success: false },
        success: false,
      });
      const { controller, deps } = createController(quietRun(9));

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ completionReason: 'runner_disconnected', success: true });
      expect(deps.finalizeAbandonedRun).toHaveBeenCalledWith(OPERATION_ID, 'runner_disconnected');
    });

    it('keeps a run that reported moments ago and says the runner is unreachable', async () => {
      // The socket may have just dropped while ingest (over HTTP) still flows.
      executeToolCall.mockResolvedValue(offline);
      const { controller, deps } = createController(quietRun(0.5));

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ failureReason: 'runner_unreachable', success: false });
      expect(deps.agentOperationModel.settleDisconnectedRunner).not.toHaveBeenCalled();
      expect(deps.finalizeAbandonedRun).not.toHaveBeenCalled();
      expect(deps.topicModel.settleRunningOperation).not.toHaveBeenCalled();
    });

    it('keeps the run when an ingest batch wins the claim', async () => {
      executeToolCall.mockResolvedValue(offline);
      const { controller, deps } = createController(quietRun(8));
      deps.agentOperationModel.settleDisconnectedRunner.mockResolvedValue(false);

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ failureReason: 'runner_unreachable', success: false });
      expect(deps.finalizeAbandonedRun).not.toHaveBeenCalled();
    });

    it('does not settle a connected runner that failed to stop its process', async () => {
      executeToolCall.mockResolvedValue({
        state: { exited: false, reason: 'orphan_alive' },
        success: false,
      });
      const { controller, deps } = createController(quietRun(20));

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ failureReason: 'runner_unconfirmed', success: false });
      expect(deps.agentOperationModel.settleDisconnectedRunner).not.toHaveBeenCalled();
    });

    it('settles a run silent for the whole hetero window as lease_expired', async () => {
      executeToolCall.mockResolvedValue({ state: { exited: false }, success: true });
      const { controller, deps } = createController(quietRun(61));

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ completionReason: 'lease_expired', success: true });
      expect(deps.agentOperationModel.settleStaleRunning).toHaveBeenCalledWith(
        OPERATION_ID,
        expect.any(Date),
      );
      expect(deps.finalizeAbandonedRun).toHaveBeenCalledWith(OPERATION_ID, 'lease_expired');
    });

    it('leaves a run that already settled alone', async () => {
      executeToolCall.mockResolvedValue(offline);
      const { controller, deps } = createController({ status: 'done', updatedAt: minutesAgo(30) });

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result.success).toBe(false);
      expect(deps.agentOperationModel.settleDisconnectedRunner).not.toHaveBeenCalled();
    });

    it('still ends the run when the abandonment side effects fail', async () => {
      executeToolCall.mockResolvedValue(offline);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { controller, deps } = createController(quietRun(8));
      deps.finalizeAbandonedRun.mockRejectedValue(new Error('db down'));

      const result = await controller.interruptTask({
        operationId: OPERATION_ID,
        topicId: TOPIC_ID,
      });

      expect(result).toMatchObject({ completionReason: 'runner_disconnected', success: true });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    describe('force', () => {
      it('ends a recently active run on an offline device as runner_disconnected', async () => {
        executeToolCall.mockResolvedValue(offline);
        const { controller, deps } = createController(quietRun(0.5));

        const result = await controller.interruptTask({
          force: true,
          operationId: OPERATION_ID,
          topicId: TOPIC_ID,
        });

        expect(result).toMatchObject({ completionReason: 'runner_disconnected', success: true });
        // No lease bound: the person chose to end it now.
        expect(deps.agentOperationModel.settleDisconnectedRunner).toHaveBeenCalledWith(
          OPERATION_ID,
          undefined,
        );
      });

      it('settles an unconfirmed stop on a connected device like a confirmed one', async () => {
        executeToolCall.mockResolvedValue({ state: { exited: false }, success: true });
        const { controller, deps } = createController(quietRun(1));

        const result = await controller.interruptTask({
          force: true,
          operationId: OPERATION_ID,
          topicId: TOPIC_ID,
        });

        expect(result).toMatchObject({ deviceCancellationConfirmed: false, success: true });
        expect(deps.agentOperationModel.settleRunning).toHaveBeenCalledWith(
          OPERATION_ID,
          'interrupted',
        );
        expect(deps.topicModel.settleRunningOperation).toHaveBeenCalledWith(
          TOPIC_ID,
          OPERATION_ID,
          'active',
        );
        expect(settleAgentRunFee).toHaveBeenCalledTimes(1);
        expect(releaseHeteroSteers).toHaveBeenCalledWith(OPERATION_ID);
        expect(deps.finalizeAbandonedRun).not.toHaveBeenCalled();
      });
    });
  });
});
