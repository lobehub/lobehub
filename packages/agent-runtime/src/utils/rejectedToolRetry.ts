import type { ChatToolPayload, ToolIntervention } from '@lobechat/types';
import { isUserToolRejectionContent, TOOL_REJECTION_RETRY_BLOCKED_REASON } from '@lobechat/types';

import { isFoldedAssistantGroup } from '../agents/pendingToolMessages';

export const REJECTED_TOOL_RETRY_REASON = TOOL_REJECTION_RETRY_BLOCKED_REASON;
export const REJECTED_TOOL_RETRY_FINISH_REASON = 'tool_retry_after_rejection';
export const REJECTED_TOOL_RETRY_STOP_NOTE =
  'Stopped because the model kept calling a tool the user had rejected.';

const USER_INTERACTION_IDENTIFIER = 'lobe-user-interaction';
const BLOCKED_CONTENT_PREFIX = 'Tool call blocked: the user already rejected';
const BLOCKED_KEY_PATTERN = new RegExp(`^${BLOCKED_CONTENT_PREFIX} (\\S+) in this turn`);

export const buildRejectedToolRetryContent = (toolKey: string): string =>
  `${BLOCKED_CONTENT_PREFIX} ${toolKey} in this turn, so this call was not executed and no new approval was requested. Do not call ${toolKey} again until the user replies. Ask the user how to proceed (use askUserQuestion when it is available, otherwise reply in plain text), or continue with a different tool.`;

interface TurnToolRow {
  apiName?: string;
  content?: unknown;
  identifier?: string;
  intervention?: ToolIntervention;
}

/** Reads both the raw tool rows and the folded `assistantGroup` shape. */
const toolRowsOf = (message: any): TurnToolRow[] => {
  if (isFoldedAssistantGroup(message)) {
    return (message.children ?? [])
      .flatMap((child: any) => child.tools ?? [])
      .map((tool: any) => ({
        apiName: tool.apiName,
        content: tool.result?.content,
        identifier: tool.identifier,
        intervention: tool.intervention,
      }));
  }
  if (message?.role !== 'tool') return [];
  return [
    {
      apiName: message.plugin?.apiName,
      content: message.content,
      identifier: message.plugin?.identifier,
      intervention: message.pluginIntervention,
    },
  ];
};

/**
 * What the user has refused since they last spoke. A new user message or an
 * answered question is fresh direction, so either one lifts the block.
 */
const readTurnRejections = (messages: unknown[] | undefined) => {
  const list = (messages ?? []) as any[];
  const turnStart = list.findLastIndex((message) => message?.role === 'user') + 1;
  const rejectedKeys = new Set<string>();
  const blockedKeys = new Set<string>();

  for (const row of list.slice(turnStart).flatMap(toolRowsOf)) {
    if (row.identifier === USER_INTERACTION_IDENTIFIER && row.intervention?.status === 'approved') {
      rejectedKeys.clear();
      blockedKeys.clear();
    } else if (typeof row.content === 'string' && BLOCKED_KEY_PATTERN.test(row.content)) {
      blockedKeys.add(BLOCKED_KEY_PATTERN.exec(row.content)![1]);
    } else if (
      row.intervention?.status === 'rejected' &&
      !row.intervention.skipped &&
      row.identifier &&
      isUserToolRejectionContent(row.content)
    ) {
      rejectedKeys.add(`${row.identifier}/${row.apiName}`);
    }
  }

  return { blockedKeys, rejectedKeys };
};

/**
 * Splits a model turn into calls to a tool the user already rejected and calls
 * that may proceed. Only the rejected tool key is held back, so a parallel call
 * to a different tool still runs.
 */
export const partitionRejectedToolRetries = (
  toolsCalling: ChatToolPayload[],
  messages: unknown[] | undefined,
) => {
  const { blockedKeys, rejectedKeys } = readTurnRejections(messages);
  const blockedRetries: ChatToolPayload[] = [];
  const remainingCalls: ChatToolPayload[] = [];

  for (const call of toolsCalling) {
    const isRetry = rejectedKeys.has(`${call.identifier}/${call.apiName}`);
    (isRetry ? blockedRetries : remainingCalls).push(call);
  }

  return {
    blockedRetries,
    /** The model was already told about one of these tools and called it again anyway. */
    ignoredBlock: blockedRetries.some((call) =>
      blockedKeys.has(`${call.identifier}/${call.apiName}`),
    ),
    remainingCalls,
  };
};
