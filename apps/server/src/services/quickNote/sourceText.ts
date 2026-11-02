/**
 * Normalizes rich-text JSON into bounded plain source text.
 *
 * Before:
 * - `{ root: { children: [{ text: "First" }, { text: "Second" }] } }`
 *
 * After:
 * - `First\nSecond`
 */
export const renderQuickNoteSourceText = (editorData: Record<string, unknown>): string => {
  const textNodes: string[] = [];

  // Walk only JSON values and collect explicit editor text nodes. This avoids
  // placing Lexical structure and formatting metadata into the model prompt.
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) textNodes.push(record.text.trim());
    if (typeof record.markdown === 'string' && record.markdown.trim()) {
      textNodes.push(record.markdown.trim());
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'markdown' && key !== 'text') visit(child);
    }
  };

  visit(editorData);
  return textNodes.join('\n');
};
