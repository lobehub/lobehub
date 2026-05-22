import { isObjectLike } from '@lobechat/utils';

export const hasMeaningfulEditorContent = (editorData: unknown): boolean => {
  if (!isObjectLike(editorData)) return false;

  const root = editorData.root;

  // Unknown shapes are treated as meaningful so callers do not drop data they
  // cannot safely classify.
  if (!isObjectLike(root) || !Array.isArray(root.children)) return true;

  const walk = (node: unknown): boolean => {
    if (!isObjectLike(node)) return false;

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
