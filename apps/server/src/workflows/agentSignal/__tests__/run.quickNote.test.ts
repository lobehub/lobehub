// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES, createSourceEvent } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';

import type { RunAgentSignalWorkflowDeps } from '@/server/workflows/agentSignal/run';
import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(false),
}));

const createWorkflowContext = <TPayload>(requestPayload: TPayload) => ({
  requestPayload,
  run: async <TRunResult>(_stepId: string, handler: () => Promise<TRunResult>) => handler(),
});

const createProcessor = () => ({
  completeWithoutGeneration: vi.fn(),
  dispatchGeneration: vi.fn(),
  judgeContentChange: vi.fn(),
  judgeRun: vi.fn(),
  markProposalsStale: vi.fn(),
});

describe('runAgentSignalWorkflow Quick Note wiring', () => {
  /**
   * @example
   * The workflow runner is the composition root that hands Agent Signal its Quick Note processor;
   * `agentSignal` itself never imports `quickNote`.
   */
  it('injects the Quick Note processor for Quick Note sources', async () => {
    const db = {} as never;
    const processor = createProcessor();
    const createQuickNoteProcessor: NonNullable<
      RunAgentSignalWorkflowDeps['createQuickNoteProcessor']
    > = vi.fn(() => processor);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: {
        quickNoteId: 'qn_1',
        runId: 'run_qn_1',
        sourceHistoryId: 'history_qn_1',
        trigger: 'manual',
        userId: 'user_1',
      },
      scopeKey: 'quick-note:qn_1',
      sourceId: 'run_qn_1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(
      createWorkflowContext({ sourceEvent, userId: 'user_1', workspaceId: 'ws_1' }),
      {
        createQuickNoteProcessor,
        createRuntimeGuardBackend: () => undefined as never,
        createSnapshotStore: () => null,
        executeSourceEvent,
        getDb: async () => db,
      },
    );

    expect(createQuickNoteProcessor).toHaveBeenCalledWith({
      db,
      userId: 'user_1',
      workspaceId: 'ws_1',
    });
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.objectContaining({ quickNoteAnalyze: processor }),
      }),
    );
  });

  it('does not create a Quick Note processor for other sources', async () => {
    const createQuickNoteProcessor: NonNullable<
      RunAgentSignalWorkflowDeps['createQuickNoteProcessor']
    > = vi.fn(createProcessor);
    const executeSourceEvent: NonNullable<RunAgentSignalWorkflowDeps['executeSourceEvent']> = vi.fn(
      async () => undefined,
    );
    const sourceEvent = createSourceEvent({
      payload: { message: 'remember this', messageId: 'msg_1' },
      scopeKey: 'topic:topic_1',
      sourceId: 'source_1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      timestamp: Date.now(),
    });

    await runAgentSignalWorkflow(createWorkflowContext({ sourceEvent, userId: 'user_1' }), {
      createQuickNoteProcessor,
      createRuntimeGuardBackend: () => undefined as never,
      createSnapshotStore: () => null,
      executeSourceEvent,
      getDb: async () => ({}) as never,
    });

    expect(createQuickNoteProcessor).not.toHaveBeenCalled();
    expect(executeSourceEvent).toHaveBeenCalledWith(
      sourceEvent,
      expect.any(Object),
      expect.objectContaining({
        policyOptions: expect.not.objectContaining({ quickNoteAnalyze: expect.anything() }),
      }),
    );
  });
});
