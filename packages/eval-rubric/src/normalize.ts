/**
 * Normalize text for comparison: trim whitespace, optionally lowercase
 */
export const normalize = (text: string, caseSensitive = false): string => {
  const trimmed = text.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
};
