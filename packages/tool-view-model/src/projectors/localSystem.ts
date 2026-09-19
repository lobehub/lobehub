import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** State a settled command keeps: everything except the output itself. */
const OUTPUT_KEYS = new Set(['output', 'stdout']);

/**
 * `runCommand`.
 *
 * The command's output is stored THREE times: the tool message body,
 * `state.stdout`, and the legacy `state.output`. All three go. What stays is the
 * small settled metadata the collapsed row reads — exit code, success,
 * background flag, command id, stderr, produced files.
 *
 * The card DOES render the output, but only once the row is expanded, and the
 * card mounts with that expansion — so it hydrates then rather than riding along
 * with every conversation load. Hence `'render'`.
 */
export const runCommandProjector: ToolProjector = ({ content, pluginState }) => {
  if (!isRecord(pluginState)) {
    return content ? { content: null, storedPayloadNeededBy: 'render' } : undefined;
  }

  const carriesOutput =
    typeof pluginState.stdout === 'string' || typeof pluginState.output === 'string' || !!content;
  if (!carriesOutput) return undefined;

  const projectedState = Object.fromEntries(
    Object.entries(pluginState).filter(([key]) => !OUTPUT_KEYS.has(key)),
  );

  return { content: null, pluginState: projectedState, storedPayloadNeededBy: 'render' };
};
