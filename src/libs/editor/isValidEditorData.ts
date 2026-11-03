const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isValidEditorData = (value: unknown): value is Record<string, unknown> => {
  if (!isObject(value)) return false;

  const root = value.root;
  if (!isObject(root)) return false;

  return root.type === 'root' && Array.isArray(root.children) && root.children.length > 0;
};
