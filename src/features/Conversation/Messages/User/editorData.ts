/**
 * Whether a persisted Lexical editor state has anything to render. Sending only
 * attachments still saves the composer's empty paragraph, which would render as
 * a blank line above the images.
 */
export const hasRenderableEditorData = (editorData: unknown): boolean => {
  if (!editorData || typeof editorData !== 'object') return false;

  const blocks = (editorData as { root?: { children?: unknown } }).root?.children;
  if (!Array.isArray(blocks)) return false;

  return blocks.some(
    (block) =>
      block?.type !== 'paragraph' || (Array.isArray(block.children) && block.children.length > 0),
  );
};
