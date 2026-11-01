import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `grepContent`, for both the local system and the cloud sandbox — they share
 * one inspector (`shared-tool-ui/Inspector/GrepContent`) and neither registers
 * a render.
 *
 * That inspector reads `totalMatches`, which the state already carries. The
 * `matches` array beside it — every matching path, sometimes with the matching
 * line — has no reader on screen at all, and it is essentially the whole state:
 * on a sampled local-system session, 26 kB of it against the chip's one number.
 *
 * So `matches` goes and `totalMatches` stays where it was; nothing to pin. The
 * body is the model's copy of the same result and goes with it, coming back
 * through the fallback render when the row is expanded.
 */
export const grepContentProjector: ToolProjector = ({ content, pluginState }) => {
  if (!isRecord(pluginState)) {
    return content ? { content: null, storedPayloadNeededBy: 'render' } : undefined;
  }

  const { matches: _matches, ...rest } = pluginState;

  return { content: null, pluginState: rest, storedPayloadNeededBy: 'render' };
};
