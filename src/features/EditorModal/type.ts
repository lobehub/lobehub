import type { IEditor } from '@lobehub/editor';

/**
 * The editor instance is created by the lazily-loaded content half but read by
 * the footer, and the two are siblings in the modal tree — hence a plain object
 * rather than context. `notifyReady` lets the footer keep Save disabled until
 * the document exists; without it a click during the chunk load would read an
 * empty document and save it over the caller's content.
 */
export interface EditorBridge {
  current?: IEditor;
  notifyReady?: () => void;
}
