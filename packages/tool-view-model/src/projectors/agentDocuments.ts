import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `readDocument`.
 *
 * The only surface is the inspector chip, which prints `pluginState.title` and
 * falls back to the call's document id. Everything else in state is the document
 * itself, stored twice — `content` and `xml`, two representations of the same
 * text, together averaging ~63 kB against the 53 bytes the chip renders.
 *
 * The message body is the model's copy and is dropped with them; the reader
 * surface fetches the raw payload when it needs the document.
 */
export const readDocumentProjector: ToolProjector = ({ pluginState }) => {
  if (!isRecord(pluginState)) return { content: null, storedPayloadNeededBy: 'render' };

  const { content: _content, xml: _xml, ...rest } = pluginState;

  return { content: null, pluginState: rest, storedPayloadNeededBy: 'render' };
};
