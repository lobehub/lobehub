import type { AgentRuntimeHost } from '../transport';
import type { AgentEvent, AgentInstruction, InstructionExecutor } from '../types';

/**
 * `finish` executor — terminates the operation.
 *
 * First executor hosted in the package (LOBE-10949 Tier A): it depends only on
 * the `StreamSink` + `OperationStore` transports and the operation context, so
 * the server just provides those adapters. Behavior mirrors the previous
 * server-local implementation exactly.
 */
export const finish =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operation, transports } = host;

    // Clear the topic's running-operation mark so a reconnect doesn't
    // re-trigger after completion. Best-effort — the adapter swallows failures.
    await transports.operationStore?.clearRunningMark();

    // Publish the execution-complete stream event. `finalState.messages` +
    // tool-set fields are stripped centrally inside the sink adapter, so this
    // call site stays unaware.
    await transports.stream.publishEvent({
      data: {
        finalState: { ...state, status: 'done' },
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex: operation.stepIndex,
      type: 'step_complete',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    const events: AgentEvent[] = [{ finalState: newState, reason, reasonDetail, type: 'done' }];

    return { events, newState };
  };
