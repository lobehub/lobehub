/**
 * The local executor hands a screenshot to the model as `state.images`. The
 * gateway contract is `state.dataUrl`: the server stores it as a file and the
 * Claude Code MCP tool turns it into an image block, and a deployed server may
 * be older than this client, so the wire format stays as it was.
 */
export const toGatewayToolState = (apiName: string, state: unknown): unknown => {
  if (apiName !== 'screenshot') return state;
  const { images, ...rest } = (state ?? {}) as { images?: { url?: string }[] };
  const dataUrl = images?.[0]?.url;
  return dataUrl ? { ...rest, dataUrl } : state;
};
