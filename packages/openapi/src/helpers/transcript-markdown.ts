interface TranscriptRow {
  content: string | null;
  createdAt: string;
  role: string;
  toolCallId: string | null;
  tools: Record<string, unknown>[] | null;
}

const ROLE_LABEL: Record<string, string> = {
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  user: 'User',
};

const toolName = (tool: Record<string, unknown>) =>
  [tool.identifier, tool.apiName].filter((part) => typeof part === 'string' && part).join('.') ||
  'tool';

/**
 * One page of a topic transcript as Markdown: a heading per message (role and
 * time), its text, and one line per tool call it made. Tool results are quoted
 * under the call id they answer.
 */
export const renderTranscriptMarkdown = (
  title: string | null,
  rows: TranscriptRow[],
  { first }: { first: boolean },
): string => {
  const lines: string[] = first ? [`# ${title || 'Untitled topic'}`, ''] : [];

  for (const row of rows) {
    const label = ROLE_LABEL[row.role] ?? row.role;
    lines.push(`## ${label} · ${row.createdAt}`, '');

    const text = row.content?.trim();
    if (row.role === 'tool') {
      lines.push(`> Result of \`${row.toolCallId ?? 'unknown call'}\``, '');
      if (text) lines.push('```', text, '```', '');
      continue;
    }

    if (text) lines.push(text, '');
    for (const tool of row.tools ?? []) {
      lines.push(`- Called \`${toolName(tool)}\` (\`${String(tool.id ?? '')}\`)`);
    }
    if (row.tools?.length) lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
};
