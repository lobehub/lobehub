import type { UIChatMessage } from '@lobechat/types';

/** A closed/completed/historical topic never owns a background MCP polling loop. */
export function mcpActivityDeadline(
  messages: Pick<
    UIChatMessage,
    | 'id'
    | 'role'
    | 'tools'
    | 'parentId'
    | 'tool_call_id'
    | 'plugin'
    | 'pluginState'
    | 'content'
    | 'error'
    | 'pluginError'
    | 'createdAt'
  >[],
  now = Date.now(),
) {
  let deadline = 0;
  const existingCalls = new Set(
    messages
      .filter((row) => row.role === 'tool')
      .map((row) => JSON.stringify([row.parentId, row.tool_call_id])),
  );
  for (const message of messages) {
    // Gateway streams the assistant's tool declarations before the persisted tool
    // placeholder is replicated. That declaration also owns bounded discovery.
    if (message.role === 'assistant' && !message.error) {
      const unresolved = message.tools?.some(
        (call) => call.type === 'mcp' && !existingCalls.has(JSON.stringify([message.id, call.id])),
      );
      const until = new Date(message.createdAt).getTime() + 180_000;
      if (unresolved && until > now) deadline = Math.max(deadline, until);
    }
    if (
      message.role !== 'tool' ||
      message.plugin?.type !== 'mcp' ||
      message.content ||
      message.error ||
      message.pluginError ||
      message.pluginState?.mcpClientComplete
    )
      continue;
    const pending = message.pluginState?.mcpElicitation as { deadline?: number } | undefined;
    const invocationDeadline = message.pluginState?.mcpInvocationDeadline;
    const until =
      pending?.deadline ??
      (typeof invocationDeadline === 'number'
        ? invocationDeadline
        : new Date(message.createdAt).getTime() + 180_000);
    if (until > now) deadline = Math.max(deadline, until);
  }
  return deadline;
}
