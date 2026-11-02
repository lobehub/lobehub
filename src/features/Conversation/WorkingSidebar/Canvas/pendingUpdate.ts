import { CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import type { UIChatMessage } from '@lobechat/types';
import { safeParsePartialJSON } from '@lobechat/utils';

export type CanvasUpdateStatus = 'awaitingApproval' | 'executing' | 'none' | 'streaming';

const SETTLED_INTERVENTIONS = new Set(['aborted', 'rejected']);

const isSettledToolMessage = (message: UIChatMessage) =>
  !!message.content ||
  message.pluginState !== undefined ||
  !!message.pluginError ||
  SETTLED_INTERVENTIONS.has(message.pluginIntervention?.status ?? '');

export const getCanvasUpdateStatus = (
  messages: UIChatMessage[],
  canvasId: string,
): CanvasUpdateStatus => {
  const toolMessages = new Map(
    messages
      .filter((message) => message.role === 'tool' && message.tool_call_id)
      .map((message) => [message.tool_call_id!, message]),
  );

  for (const message of messages) {
    for (const tool of message.tools ?? []) {
      if (tool.identifier !== CanvasIdentifier || tool.apiName !== CanvasApiName.updateCanvas)
        continue;
      if (SETTLED_INTERVENTIONS.has(tool.intervention?.status ?? '')) continue;

      const toolMessage = toolMessages.get(tool.id);
      if (toolMessage && isSettledToolMessage(toolMessage)) continue;

      const args = safeParsePartialJSON(tool.arguments) as { canvasId?: string } | undefined;
      if (args?.canvasId !== canvasId) continue;

      if (
        toolMessage?.pluginIntervention?.status === 'pending' ||
        tool.intervention?.status === 'pending'
      )
        return 'awaitingApproval';
      return toolMessage ? 'executing' : 'streaming';
    }
  }

  return 'none';
};
