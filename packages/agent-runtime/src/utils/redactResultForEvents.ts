import type { UIChatMessage } from '@lobechat/types';

import type { ToolRunResult } from '../transport/tool';

/** Trim raw skill payloads from event copies while preserving the result used for Work registration. */
export const redactResultForEvents = (result: ToolRunResult): ToolRunResult =>
  result.workRegistration?.type === 'skill'
    ? { ...result, workRegistration: { ...result.workRegistration, args: undefined, data: null } }
    : result;

/** Keep untruncated Work payloads in durable storage, outside runtime and UI message lists. */
export const omitToolWorkRegistration = (message: UIChatMessage): UIChatMessage => {
  let visible = message;
  if (message.metadata?.toolWorkRegistration) {
    const { toolWorkRegistration: _intent, ...metadata } = message.metadata;
    visible = { ...message, metadata };
  }
  if (!visible.columns && !visible.compressedMessages && !visible.members) return visible;
  return {
    ...visible,
    ...(visible.columns && {
      columns: visible.columns.map((column) => column.map(omitToolWorkRegistration)),
    }),
    ...(visible.compressedMessages && {
      compressedMessages: visible.compressedMessages.map(omitToolWorkRegistration),
    }),
    ...(visible.members && { members: visible.members.map(omitToolWorkRegistration) }),
  };
};
