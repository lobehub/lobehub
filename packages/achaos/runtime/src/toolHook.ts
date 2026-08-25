import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export interface MutableToolCallEvent {
  apiName: string;
  callIndex: number;
  mock: (result: { content: string }) => void;
  operationId: string;
  stepIndex: number;
}

export interface RuntimeChaosHook {
  handler: (event: MutableToolCallEvent) => Promise<void>;
  id: string;
  type: 'beforeToolCall';
}

/** Compatible with LobeHub's local beforeToolCall hook handler. */
export const createBeforeToolCallChaosHandler =
  (controller: RuntimeChaosController) => async (event: MutableToolCallEvent) => {
    const activations = controller.activationsFor({
      apiName: event.apiName,
      callIndex: event.callIndex,
      operationId: event.operationId,
      phase: 'before_tool_call',
      stepIndex: event.stepIndex,
    });

    for (const { effect, signal } of activations) {
      if (effect.type === 'delay') await delayWithAbort(effect.durationMs, signal);
      if (effect.type === 'drop') {
        event.mock({
          content: JSON.stringify({
            error: 'Tool call dropped by chaos experiment',
            errorType: 'ChaosDroppedToolCall',
          }),
        });
      }
      if (effect.type === 'replace_result') event.mock({ content: effect.content });
    }
  };

/** Structurally compatible with AgentRuntimeService.execAgent({ hooks }). */
export const createRuntimeChaosHooks = (controller: RuntimeChaosController): RuntimeChaosHook[] => [
  {
    handler: createBeforeToolCallChaosHandler(controller),
    id: 'agent-chaos-before-tool-call',
    type: 'beforeToolCall',
  },
];
