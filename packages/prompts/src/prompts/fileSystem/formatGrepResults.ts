export interface FormatGrepResultsParams {
  matches: string[];
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
  const matchList = displayMatches.map((m) => `  ${m}`).join('\n');
  const moreInfo =
    matches.length > maxDisplay ? `\n  ... and ${matches.length - maxDisplay} more` : '';

  return `${message}:\n${matchList}${moreInfo}`;
};
