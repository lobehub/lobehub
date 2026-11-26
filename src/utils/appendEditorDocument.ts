export type EditorDocument = Record<string, unknown>;

/**
 * Append `extra`'s top-level blocks after `base`'s. Both are serialized
 * editor states (`{ root: { children } }`); when either has another shape,
 * `base` is returned untouched so content the user already has is never lost.
 * Merging the JSON (not Markdown) keeps rich nodes such as mentions and image
 * references bound to their files.
 */
export const appendEditorDocument = (
  base: EditorDocument,
  extra: EditorDocument,
): EditorDocument => {
  const baseRoot = base.root as { children?: unknown } | undefined;
  const extraRoot = extra.root as { children?: unknown } | undefined;
  if (!Array.isArray(baseRoot?.children) || !Array.isArray(extraRoot?.children)) return base;

  return {
    ...base,
    root: { ...baseRoot, children: [...baseRoot.children, ...extraRoot.children] },
  };
};

/**
 * Plain-text editor document: one paragraph per line, Markdown kept as typed.
 *
 * For appending a message that has no persisted editor JSON to a rich draft:
 * reparsing the whole composer as Markdown would turn the draft's rich nodes
 * (image references, mentions) into plain text, since they have no Markdown
 * reader. Only the incoming text becomes blocks; the draft stays as it is.
 */
export const plainTextToEditorDocument = (text: string): EditorDocument => ({
  root: {
    children: text.split('\n').map((line) => ({
      children: line
        ? [
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: line,
              type: 'text',
              version: 1,
            },
          ]
        : [],
      direction: null,
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
      type: 'paragraph',
      version: 1,
    })),
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});
