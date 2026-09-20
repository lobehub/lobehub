import { getToolProjector } from './registry';

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
 * the screen — that arrives with the message, through the read path. On this
 * wire the event drives two things and nothing else: an executor's
 * `onAfterCall` hook, and whether a Work view needs refreshing.
 *
 * So the body goes. Every `onAfterCall` implementation reads `result.success`,
 * and `didToolMutateWorkView` reads `result.workRegistration` — none read the
 * body. The `state` goes through the same projector the read path uses, so a
 * message looks the same mid-run as it does once settled; no `onAfterCall`
 * among the projected tools reads `result.state` at all.
 *
 * Keep that audit true: a new hook that reads a key its tool's projector drops
 * would see it missing here first.
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
  const identifier = isRecord(toolCalling) ? toolCalling.identifier : undefined;
  const apiName = isRecord(toolCalling) ? toolCalling.apiName : undefined;

  const projector = getToolProjector(
    typeof identifier === 'string' ? identifier : undefined,
    typeof apiName === 'string' ? apiName : undefined,
  );

  const { content, ...rest } = result as ToolEventResult;
  const projected: ToolEventResult = { ...rest };

  if (projector && isRecord(result.state)) {
    const projection = projector({
      apiName: String(apiName ?? ''),
      content: typeof content === 'string' ? content : '',
      identifier: String(identifier ?? ''),
      pluginState: result.state,
    });
    if (projection?.pluginState !== undefined) projected.state = projection.pluginState;
  }

  if (content === undefined && projected.state === result.state) return data;

  return { ...data, result: projected };
};
