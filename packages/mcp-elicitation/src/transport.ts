const prefix = 'mcp-invocation:';
/** Provider IDs and the originating workspace remain fixed across renderer navigation. */
export const mcpTransportCallId = (operationId: string, toolCallId: string, workspaceId?: string) =>
  `${prefix}${encodeURIComponent(operationId)}:${encodeURIComponent(toolCallId)}${workspaceId ? `:${encodeURIComponent(workspaceId)}` : ''}`;
export function mcpTransportContext(operationId: string, transportId: string) {
  if (!transportId.startsWith(prefix))
    return { toolCallId: transportId, workspaceId: undefined, scoped: false };
  const [operation, call, workspace, extra] = transportId.slice(prefix.length).split(':');
  if (extra !== undefined || !call || decodeURIComponent(operation) !== operationId)
    throw new Error('MCP transport operation identity mismatch');
  return {
    toolCallId: decodeURIComponent(call),
    workspaceId: workspace ? decodeURIComponent(workspace) : undefined,
    scoped: true,
  };
}
export const mcpOriginalCallId = (operationId: string, transportId: string) =>
  mcpTransportContext(operationId, transportId).toolCallId;
