/** The provider id is only unique inside one assistant message, never across steps or users. */
export interface McpInvocationIdentity {
  assistantMessageId: string;
  operationId: string;
  toolCallId: string;
  userId: string;
  workspaceId?: string;
}

export function mcpInvocationKey(identity: McpInvocationIdentity): string {
  if (
    ![
      identity.userId,
      identity.operationId,
      identity.assistantMessageId,
      identity.toolCallId,
    ].every((value) => typeof value === 'string' && value.length > 0)
  )
    throw new Error('Incomplete MCP invocation identity');
  if (
    identity.workspaceId !== undefined &&
    (typeof identity.workspaceId !== 'string' || !identity.workspaceId)
  )
    throw new Error('Incomplete MCP workspace identity');
  return JSON.stringify([
    identity.userId,
    identity.workspaceId ?? null,
    identity.operationId,
    identity.assistantMessageId,
    identity.toolCallId,
  ]);
}
const prefix = 'mcp-invocation:';
const version = 'v2:';
/** One identity for the producer, waiter, first delivery and persisted message anchor. */
export const mcpTransportCallId = (identity: McpInvocationIdentity) =>
  `${prefix}${version}${encodeURIComponent(mcpInvocationKey(identity))}`;

export function mcpTransportContext(
  operationId: string,
  transportId: string,
  expected?: { userId?: string; assistantMessageId?: string },
) {
  if (transportId.startsWith(prefix + version)) {
    const tuple = JSON.parse(decodeURIComponent(transportId.slice((prefix + version).length)));
    if (!Array.isArray(tuple) || tuple.length !== 5)
      throw new Error('MCP transport identity mismatch');
    const [userId, workspaceId, operation, assistantMessageId, toolCallId] = tuple;
    const identity = {
      userId,
      workspaceId: workspaceId ?? undefined,
      operationId: operation,
      assistantMessageId,
      toolCallId,
    };
    mcpInvocationKey(identity);
    if (
      (workspaceId !== null && typeof workspaceId !== 'string') ||
      operation !== operationId ||
      (expected?.userId !== undefined && expected.userId !== userId) ||
      (expected?.assistantMessageId !== undefined &&
        expected.assistantMessageId !== assistantMessageId)
    )
      throw new Error('MCP transport invocation identity mismatch');
    return { ...identity, scoped: true, completeIdentity: true };
  }
  // Decode pre-upgrade messages only. New elicitation dispatches always emit v2.
  if (!transportId.startsWith(prefix))
    return {
      toolCallId: transportId,
      workspaceId: undefined,
      userId: undefined,
      assistantMessageId: undefined,
      scoped: false,
      completeIdentity: false,
    };
  const [operation, call, workspace, extra] = transportId.slice(prefix.length).split(':');
  if (extra !== undefined || !call || decodeURIComponent(operation) !== operationId)
    throw new Error('MCP transport operation identity mismatch');
  return {
    toolCallId: decodeURIComponent(call),
    workspaceId: workspace ? decodeURIComponent(workspace) : undefined,
    userId: undefined,
    assistantMessageId: undefined,
    scoped: true,
    completeIdentity: false,
  };
}
export const mcpOriginalCallId = (operationId: string, transportId: string) =>
  mcpTransportContext(operationId, transportId).toolCallId;
