import type { ToolRunResult } from '@lobechat/agent-runtime/src/transport/tool';
import type { ToolCallHookEvent } from '@lobechat/agent-runtime/src/types/hooks';

import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export type MutableToolCallEvent = Pick<
  ToolCallHookEvent,
  'apiName' | 'callIndex' | 'mock' | 'operationId' | 'stepIndex'
>;

export interface RuntimeChaosHook {
  handler: (event: MutableToolCallEvent) => Promise<void>;
  id: string;
  type: 'beforeToolCall';
}

const failedToolResult = (message: string, errorType: string): ToolRunResult => ({
  content: JSON.stringify({ error: message, errorType }),
  error: { errorType, kind: 'stop', message },
  success: false,
});

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
      if (effect.type === 'delay') {
        try {
          await delayWithAbort(effect.durationMs, signal);
        } catch {
          event.mock(
            failedToolResult('Tool call canceled while chaos delay was active', 'Canceled'),
          );
          return;
        }
      }
      if (effect.type === 'drop') {
        event.mock(
          failedToolResult('Tool call dropped by chaos experiment', 'ChaosDroppedToolCall'),
        );
      }
      if (effect.type === 'replace_result') event.mock({ content: effect.content, success: true });
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
