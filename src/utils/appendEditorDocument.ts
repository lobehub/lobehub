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
