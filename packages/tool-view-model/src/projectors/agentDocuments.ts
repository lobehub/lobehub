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

/**
 * `listDocuments`.
 *
 * No render is registered for it, so the only surface is the inspector chip,
 * which prints one number: how many documents came back. The list itself —
 * ids, filenames, titles — has no reader on screen, and it is the whole state.
 *
 * The count is pinned as `documentCount` rather than left implicit in an array
 * length, so the chip keeps a number to read once the rows are gone.
 */
export const listDocumentsProjector: ToolProjector = ({ pluginState }) => {
  if (!isRecord(pluginState)) return { content: null, storedPayloadNeededBy: 'render' };

  const { documents: _documents, ...rest } = pluginState;
  const documents = pluginState.documents;

  return {
    content: null,
    pluginState: {
      ...rest,
      documentCount: Array.isArray(documents)
        ? documents.length
        : typeof pluginState.documentCount === 'number'
          ? pluginState.documentCount
          : undefined,
    },
    storedPayloadNeededBy: 'render',
  };
};
