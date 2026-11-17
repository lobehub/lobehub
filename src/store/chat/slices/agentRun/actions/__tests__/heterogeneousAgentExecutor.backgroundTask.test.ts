/** Claude Code background tasks of a run this desktop hosts itself. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { useUserStore } from '@/store/user';

import { getLocalBackgroundTaskStopper } from '../transports/hetero/backgroundTasks';
import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';
import {
  ccInit,
  ccResult,
  ccText,
  ccToolResult,
  ccToolUse,
  createMockStore,
  defaultParams,
  setupIpcCapture,
} from './heterogeneousAgentExecutor.testUtils';

const followUp = vi.hoisted(() => ({ mode: 'queue' as 'legacy' | 'queue' | 'steer' }));
vi.mock('../lifecycle/followUpMode', () => ({ getFollowUpMode: () => followUp.mode }));

const mockSendPrompt = vi.fn();
const mockStartSession = vi.fn();
const mockStopBackgroundTask = vi.fn();

vi.mock('@/services/message', () => ({
  messageService: {
    batchMutate: vi.fn(async (operations: any[]) => ({
      results: operations.map((operation, index) => ({ index, success: true, ...operation })),
      success: true,
    })),
    createMessage: vi.fn(async (params: any) => ({ id: params.id })),
    getMessages: vi.fn(async () => []),
    updateMessage: vi.fn(async () => undefined),
    updateMessageError: vi.fn(async () => ({ success: true })),
    updateToolMessage: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: vi.fn(async () => ({})),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    stopBackgroundTask: (...args: any[]) => mockStopBackgroundTask(...args),
    stopSession: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    beginLocalHeteroRunFee: vi.fn(async () => ({ feeId: 'fee-1' })),
    finishLocalHeteroRunFee: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: {
    recordUsage: vi.fn(async () => undefined),
    selectAccountForAgent: vi.fn(async () => null),
  },
}));

vi.mock('../transports/gateway/gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

const OUTPUT = '/tmp/claude-501/proj/sess/tasks/bys1w0wxo.output';

const taskStarted = {
  description: 'Ping in background',
  is_backgrounded: true,
  subtype: 'task_started',
  task_id: 'bys1w0wxo',
  task_type: 'local_bash',
  tool_use_id: 'toolu_bash',
  type: 'system',
};

const taskNotification = {
  output_file: OUTPUT,
  status: 'completed',
  subtype: 'task_notification',
  summary: 'Ping in background',
  task_id: 'bys1w0wxo',
  tool_use_id: 'toolu_bash',
  type: 'system',
};

/** Every durable background task write, in order. */
const backgroundTaskWrites = () =>
  vi
    .mocked(messageService.batchMutate)
    .mock.calls.flatMap(([operations]) => operations)
    .filter((op: any) => op.type === 'updateToolMessage' && op.value.pluginState?.backgroundTask)
    .map((op: any) => ({ id: op.id, task: op.value.pluginState.backgroundTask }));

const withSdkLab = async (enabled: boolean, run: () => Promise<void>) => {
  const previous = useUserStore.getState().preference.lab;
  useUserStore.setState((state) => ({
    preference: {
      ...state.preference,
      lab: { ...state.preference.lab, enableClaudeCodeSdk: enabled },
    },
  }));
  try {
    await run();
  } finally {
    useUserStore.setState((state) => ({ preference: { ...state.preference, lab: previous } }));
  }
};

describe('heterogeneousAgentExecutor background tasks', () => {
  let ipc: ReturnType<typeof setupIpcCapture>;
  let stopperDuringRun: ReturnType<typeof getLocalBackgroundTaskStopper>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpcCapture();
    stopperDuringRun = undefined;
    followUp.mode = 'queue';
    mockStartSession.mockResolvedValue({ sessionId: 'ipc-sess-1' });
    mockSendPrompt.mockImplementation(async (params: any) => {
      ipc.emitRawLine(params.sessionId, ccInit());
      ipc.emitRawLine(
        params.sessionId,
        ccToolUse('msg-1', 'toolu_bash', 'Bash', { command: 'ping' }),
      );
      ipc.emitRawLine(params.sessionId, taskStarted);
      ipc.emitRawLine(
        params.sessionId,
        ccToolResult(
          'toolu_bash',
          `Command running in background. Output is being written to: ${OUTPUT}.`,
        ),
      );
      ipc.emitRawLine(params.sessionId, ccText('msg-2', 'started'));
      ipc.emitRawLine(params.sessionId, ccResult());
      stopperDuringRun = getLocalBackgroundTaskStopper(defaultParams.operationId);
      ipc.emitRawLine(params.sessionId, taskNotification);
      ipc.emitComplete(params.sessionId);
    });
  });

  it('stores each snapshot on the Bash tool message with the run operation', async () => {
    const store = createMockStore();
    await executeHeterogeneousAgent(() => store, defaultParams);

    const writes = backgroundTaskWrites();
    expect(writes.map((w) => w.task.status)).toEqual(['running', 'running', 'completed']);
    expect(new Set(writes.map((w) => w.id)).size).toBe(1);
    expect(writes.at(-1)!.task).toMatchObject({
      operationId: defaultParams.operationId,
      outputFile: OUTPUT,
      summary: 'Ping in background',
      taskId: 'bys1w0wxo',
      toolName: 'Bash',
    });

    // The live store gets the same snapshot under its own key only.
    const live = store.internal_dispatchMessage.mock.calls
      .map(([action]: any[]) => action)
      .filter((action: any) => action.type === 'updatePluginState');
    expect(live.at(-1)).toMatchObject({
      id: writes[0].id,
      key: 'backgroundTask',
      value: { status: 'completed' },
    });
  });

  it('offers a stop for an SDK session only while the run lives', async () => {
    await withSdkLab(true, () => executeHeterogeneousAgent(() => createMockStore(), defaultParams));

    expect(stopperDuringRun).toBeDefined();
    mockStopBackgroundTask.mockResolvedValue(undefined);
    await stopperDuringRun!('bys1w0wxo');
    expect(mockStopBackgroundTask).toHaveBeenCalledWith('ipc-sess-1', 'bys1w0wxo');
    expect(getLocalBackgroundTaskStopper(defaultParams.operationId)).toBeUndefined();
  });

  it.each(['queue', 'legacy'] as const)(
    'offers a stop for a CLI run in %s mode, whose input stays open though nothing is steered',
    async (mode) => {
      followUp.mode = mode;
      await withSdkLab(false, () =>
        executeHeterogeneousAgent(() => createMockStore(), defaultParams),
      );

      expect(stopperDuringRun).toBeDefined();
      mockStopBackgroundTask.mockResolvedValue(undefined);
      await stopperDuringRun!('bys1w0wxo');
      expect(mockStopBackgroundTask).toHaveBeenCalledWith('ipc-sess-1', 'bys1w0wxo');
      expect(getLocalBackgroundTaskStopper(defaultParams.operationId)).toBeUndefined();
    },
  );

  it('offers a stop for a CLI run in Steer mode', async () => {
    followUp.mode = 'steer';
    await withSdkLab(false, () =>
      executeHeterogeneousAgent(() => createMockStore(), defaultParams),
    );

    expect(stopperDuringRun).toBeDefined();
    mockStopBackgroundTask.mockResolvedValue(undefined);
    await stopperDuringRun!('bys1w0wxo');
    expect(mockStopBackgroundTask).toHaveBeenCalledWith('ipc-sess-1', 'bys1w0wxo');
    expect(getLocalBackgroundTaskStopper(defaultParams.operationId)).toBeUndefined();
  });
});
