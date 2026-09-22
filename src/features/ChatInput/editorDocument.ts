import type { IEditor } from '@lobehub/editor';

// A kernel registers its data sources when its root mounts and drops them again
// on destroy, so a debounced handler landing mid route switch can reach one that
// can no longer serialize. Callers must skip their work instead of reading the
// failure as an empty composer — persisting that emptiness deletes the draft.
export const canSerialize = (editor?: IEditor) => !!editor?.getLexicalEditor();

export const readDocument = (editor: IEditor | undefined, type: string): unknown => {
  if (!canSerialize(editor)) return undefined;
  try {
    return editor!.getDocument(type);
  } catch {
    return undefined;
  }
};

export const writeDocument = (
  editor: IEditor | undefined,
  type: string,
  content: any,
  options?: Record<string, unknown>,
) => {
  if (!canSerialize(editor)) return;
  try {
    editor!.setDocument(type, content, options);
  } catch {
    /* the composer this content belongs to went away mid write */
  }
};
