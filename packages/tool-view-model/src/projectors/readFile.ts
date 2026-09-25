import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `readFile` — the largest single tool in production, and another one storing
 * its payload twice: the message body and `state.content` both hold the file.
 *
 * The card reads `state.content` (`buildReadFileState` falls back to the message
 * body only for the opencode / pi variants), and it mounts with the row's
 * expansion, so both copies go and the card hydrates on open.
 *
 * `charCount` is pinned first: the card computes it from the body when state
 * doesn't carry it, so without this every file would report zero characters.
 *
 * Everything else stays, `images` above all — those are turned into `image_url`
 * parts for vision-capable models, so they are MODEL-facing, not decoration.
 */
export const readFileProjector: ToolProjector = ({ content, pluginState }) => {
  if (!isRecord(pluginState)) {
    return content ? { content: null, storedPayloadNeededBy: 'render' } : undefined;
  }

  const body = pluginState.content;
  if (typeof body !== 'string') {
    return content ? { content: null, storedPayloadNeededBy: 'render' } : undefined;
  }

  const { content: _body, ...rest } = pluginState;

  return {
    content: null,
    pluginState: {
      ...rest,
      charCount: typeof pluginState.charCount === 'number' ? pluginState.charCount : body.length,
    },
    storedPayloadNeededBy: 'render',
  };
};
