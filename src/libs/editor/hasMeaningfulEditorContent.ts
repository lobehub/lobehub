const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const hasMeaningfulEditorContent = (editorData: unknown): boolean => {
  if (!isRecord(editorData)) return false;

  const root = editorData.root;

  // Unknown shapes are treated as meaningful so callers do not drop data they
  // cannot safely classify.
  if (!isRecord(root) || !Array.isArray(root.children)) return true;

  const walk = (node: unknown): boolean => {
    if (!isRecord(node)) return false;

    if (typeof node.text === 'string' && node.text.trim().length > 0) return true;

    const type = node.type;
    if (typeof type === 'string' && !['paragraph', 'root', 'text'].includes(type)) {
      return true;
    }

    const children = node.children;
    if (!Array.isArray(children)) return false;

    return children.some(walk);
  };

  return root.children.some(walk);
};
