export interface FormatGrepResultsParams {
  matches: Array<string | { content?: string; lineNumber?: number; path: string }>;
  maxDisplay?: number;
  totalMatches: number;
}

export const formatGrepResults = ({
  totalMatches,
  matches,
  maxDisplay = 20,
}: FormatGrepResultsParams): string => {
  const message = `Found ${totalMatches} matches in ${matches.length} locations`;

  if (matches.length === 0) {
    return message;
  }

  const displayMatches = matches.slice(0, maxDisplay);
  const matchList = displayMatches
    .map((m) => {
      if (typeof m === 'string') return `  ${m}`;
      const parts: string[] = [];
      if (m.path) parts.push(m.path);
      if (m.lineNumber !== undefined) parts.push(`:${m.lineNumber}`);
      if (m.content) {
        if (parts.length > 0) parts.push(`: ${m.content}`);
        else parts.push(m.content);
      }
      return `  ${parts.join('')}`;
    })
    .join('\n');
  const moreInfo =
    matches.length > maxDisplay ? `\n  ... and ${matches.length - maxDisplay} more` : '';

  return `${message}:\n${matchList}${moreInfo}`;
};
