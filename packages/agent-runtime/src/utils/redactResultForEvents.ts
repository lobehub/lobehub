import type { UIChatMessage } from '@lobechat/types';

import type { ToolRunResult } from '../transport/tool';

/** Trim raw skill payloads from event copies while preserving the result used for Work registration. */
export const redactResultForEvents = (result: ToolRunResult): ToolRunResult =>
  result.workRegistration?.type === 'skill'
    ? { ...result, workRegistration: { ...result.workRegistration, args: undefined, data: null } }
    : result;

/** Keep untruncated Work payloads in durable storage, outside the model/Redis message list. */
export const omitToolWorkRegistration = (message: UIChatMessage): UIChatMessage => {
  if (!message.metadata?.toolWorkRegistration) return message;
  const { toolWorkRegistration: _intent, ...metadata } = message.metadata;
  return { ...message, metadata };
};
