const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

/**
 * The label each `mention` node of a comment snapshot shows, by mentioned id —
 * how the author named whoever they mentioned, for feedback about it.
 */
export const collectMentionLabels = (editorData: unknown): Map<string, string> => {
  const labels = new Map<string, string>();
  const pending: unknown[] = [asRecord(editorData)?.root];

  while (pending.length > 0) {
    const node = asRecord(pending.pop());
    if (!node) continue;
    const metadata = asRecord(node.metadata);
    if (node.type === 'mention' && typeof metadata?.id === 'string') {
      const label = typeof node.label === 'string' ? node.label.trim() : '';
      if (label && !labels.has(metadata.id)) labels.set(metadata.id, label);
    }
    if (Array.isArray(node.children)) pending.push(...node.children);
  }

  return labels;
};
