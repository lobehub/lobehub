import type { RuntimeChaosController } from './controller';

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

const delay = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

/** Compatible with LobeHub's local beforeToolCall hook handler. */
export const createBeforeToolCallChaosHandler =
  (controller: RuntimeChaosController) => async (event: MutableToolCallEvent) => {
    const effects = controller.effectsFor({
      apiName: event.apiName,
      callIndex: event.callIndex,
      operationId: event.operationId,
      phase: 'before_tool_call',
      stepIndex: event.stepIndex,
    });

    for (const effect of effects) {
      if (effect.type === 'delay') await delay(effect.durationMs);
      if (effect.type === 'drop') {
        event.mock({
          content: JSON.stringify({
            error: 'Tool call dropped by chaos experiment',
            errorType: 'ChaosDroppedToolCall',
          }),
        });
      }
      if (effect.type === 'replace_result') event.mock({ content: effect.content });
      if (effect.type === 'throw') {
        event.mock({
          content: JSON.stringify({
            error: effect.message ?? effect.errorType,
            errorType: effect.errorType,
          }),
        });
      }
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
