/**
 * When each image-generation tool call started, keyed by tool call id.
 *
 * The streaming canvas and the result canvas are different components, so the
 * card remounts when the tool returns; keeping the start time here lets the
 * elapsed counter carry on instead of resetting to zero.
 */
const startedAtByToolCall = new Map<string, number>();

/** Start (or continue) the clock for a call that is generating right now. */
export const startGenerationClock = (toolCallId?: string, now = Date.now()) => {
  if (!toolCallId) return;
  const existing = startedAtByToolCall.get(toolCallId);
  if (existing) return existing;
  startedAtByToolCall.set(toolCallId, now);
  return now;
};

/**
 * Read a clock without starting one. A card restored from history never saw its
 * generation begin, so it gets no elapsed time rather than a misleading one.
 */
export const peekGenerationClock = (toolCallId?: string) =>
  toolCallId ? startedAtByToolCall.get(toolCallId) : undefined;
