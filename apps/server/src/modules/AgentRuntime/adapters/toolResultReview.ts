import type { AgentState } from '@lobechat/agent-runtime';
import type { ChatToolPayload, MessageMetadata } from '@lobechat/types';

import type { RuntimeExecutorContext } from '../context';

/** Capture correlation before a pending result can be written by another worker. */
export function prepareToolResultReview(
  ctx: Pick<RuntimeExecutorContext, 'hookDispatcher' | 'operationId' | 'stepIndex'>,
  state: AgentState | null | undefined,
  call: Pick<ChatToolPayload, 'identifier' | 'apiName'>,
): MessageMetadata['toolResultControl'] {
  if (!ctx.hookDispatcher?.hasAfterToolCallControl(ctx.operationId, state?.host?.hooks, call))
    return;
  const name = `${call.identifier}/${call.apiName}`;
  return {
    callIndex: (state?.usage?.tools?.byTool?.find((tool) => tool.name === name)?.calls ?? 0) + 1,
    operationId: ctx.operationId,
    status: 'pending',
    stepIndex: ctx.stepIndex,
  };
}
