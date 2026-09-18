import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `runCommand`.
 *
 * The command's output is stored THREE times: the tool message body,
 * `state.stdout`, and the legacy `state.output`. The render
 * (`shared-tool-ui/Render/RunCommand`) reads `stdout || output || content` — it
 * only ever displays one of them — so the other two are pure duplication, which
 * production measurements put at roughly two thirds of this tool's payload.
 *
 * The surviving copy is NOT truncated: it renders inline in a scrollable block,
 * so trimming it would take away output the user can read today.
 */
export const runCommandProjector: ToolProjector = ({ pluginState }) => {
  if (!isRecord(pluginState)) return undefined;

  const stdout = pluginState.stdout;
  const output = pluginState.output;
  const hasStdout = typeof stdout === 'string';
  const hasOutput = typeof output === 'string';

  // Nothing in state to fall back on; the body is the only copy the render can
  // use, so leave the message exactly as stored.
  if (!hasStdout && !hasOutput) return undefined;

  const projectedState = { ...pluginState };
  // Keep whichever key the render would have picked first, drop the other.
  if (hasStdout && hasOutput) delete projectedState.output;

  return { content: null, pluginState: projectedState };
};
