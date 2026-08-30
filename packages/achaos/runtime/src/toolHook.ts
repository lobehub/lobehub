import type { ToolRunResult } from '@lobechat/agent-runtime/src/transport/tool';
import type { AgentHookEvent, ToolCallHookEvent } from '@lobechat/agent-runtime/src/types/hooks';

import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export type MutableToolCallEvent = Pick<
  ToolCallHookEvent,
  'apiName' | 'callIndex' | 'mock' | 'operationId' | 'stepIndex'
>;

export interface RuntimeChaosHook {
  handler: (event: AgentHookEvent) => Promise<void>;
  id: string;
  type: 'beforeToolCall';
}

const isMutableToolCallEvent = (
  event: AgentHookEvent,
): event is AgentHookEvent & MutableToolCallEvent =>
  typeof (event as Partial<MutableToolCallEvent>).apiName === 'string' &&
  typeof (event as Partial<MutableToolCallEvent>).callIndex === 'number' &&
  typeof (event as Partial<MutableToolCallEvent>).mock === 'function' &&
  typeof (event as Partial<MutableToolCallEvent>).stepIndex === 'number';

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

    for (const { effect, markApplied, release, signal } of activations) {
      if (effect.type === 'delay') {
        markApplied();
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
        const accepted = event.mock(
          failedToolResult('Tool call dropped by chaos experiment', 'ChaosDroppedToolCall'),
        );
        if (accepted) markApplied();
        else release();
      }
      if (effect.type === 'replace_result') {
        const accepted = event.mock({ content: effect.content, success: true });
        if (accepted) markApplied();
        else release();
      }
    }
  };

/** Structurally compatible with AgentRuntimeService.execAgent({ hooks }). */
export const createRuntimeChaosHooks = (controller: RuntimeChaosController): RuntimeChaosHook[] => [
  {
    handler: async (event) => {
      if (!isMutableToolCallEvent(event))
        throw new TypeError('beforeToolCall chaos hook received an incompatible event');
      await createBeforeToolCallChaosHandler(controller)(event);
    },
    id: 'agent-chaos-before-tool-call',
    type: 'beforeToolCall',
  },
];
