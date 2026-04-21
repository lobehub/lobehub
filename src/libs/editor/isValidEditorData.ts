const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isValidEditorData = (value: unknown): value is Record<string, unknown> => {
  return isObject(value) && Object.keys(value).length > 0;
};
