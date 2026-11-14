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

// eslint-disable-next-line import/first
import { InterventionController } from './InterventionController';

const OPERATION_ID = 'op_running';
const TOPIC_ID = 'tpc_topic';

const createController = () => {
  const deps = {
    agentOperationModel: {
      findById: vi.fn(async () => ({ createdAt: new Date(), id: OPERATION_ID })),
      settleRunning: vi.fn(async () => true),
    },
    agentRuntimeService: { interruptOperation: vi.fn(async () => false) },
    db: {},
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
});
