import { getToolProjector, isToolEventBodyUnused } from './registry';

/** The `result` a `tool_end` event carries: the same two halves, different keys. */
export interface ToolEventResult {
  [key: string]: unknown;
  content?: unknown;
  state?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Reduce the `result` on a `tool_end` before it goes over the WebSocket.
 *
 * `tool_end` announces that a tool finished; it is not how the result reaches
 * the screen — that arrives with the message, through the read path, which
 * already projects it. So the event is carrying a second copy of the largest
 * payload on the connection, and on this wire it drives only two things: an
 * executor's `onAfterCall` hook, and whether a Work view needs refreshing.
 *
 * `state` goes through the same projector the read path uses, so a tool looks
 * the same mid-run as it does once settled. No hook among the projected tools
 * reads `result.state` beyond `runCommand`'s exit code, which the projector
 * keeps.
 *
 * The body goes only for the tools {@link isToolEventBodyUnused} vouches for.
 * Shell and worktree tools keep theirs — their hooks parse it.
 *
 * Applied on the gateway push only. The OpenAI-compatible Responses endpoint
 * installs its own stream manager and never reaches this path, so its
 * `function_call_output` keeps the real output.
 */
export const projectToolEndResult = (data: unknown): unknown => {
  if (!isRecord(data)) return data;

  const result = data.result;
  if (!isRecord(result)) return data;

  const toolCalling = isRecord(data.payload) ? data.payload.toolCalling : undefined;
  const rawIdentifier = isRecord(toolCalling) ? toolCalling.identifier : undefined;
  const rawApiName = isRecord(toolCalling) ? toolCalling.apiName : undefined;
  const identifier = typeof rawIdentifier === 'string' ? rawIdentifier : undefined;
  const apiName = typeof rawApiName === 'string' ? rawApiName : undefined;

  const projector = getToolProjector(identifier, apiName);
  const dropBody = 'content' in result && isToolEventBodyUnused(identifier, apiName);

  let projectedState: unknown = result.state;
  if (projector && isRecord(result.state)) {
    const projection = projector({
      apiName: apiName ?? '',
      content: typeof result.content === 'string' ? result.content : '',
      identifier: identifier ?? '',
      pluginState: result.state,
    });
    if (projection?.pluginState !== undefined) projectedState = projection.pluginState;
  }

  if (!dropBody && projectedState === result.state) return data;

  const { content: _content, ...rest } = result as ToolEventResult;
  const projected: ToolEventResult = dropBody ? rest : { ...result };
  if (projectedState !== result.state) projected.state = projectedState;

  return { ...data, result: projected };
};
