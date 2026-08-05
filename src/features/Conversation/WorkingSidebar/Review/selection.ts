import type { ChatContextContent } from '@lobechat/types';

type DiffSelectionSide = 'additions' | 'deletions';
type CodeSelectionSide = ChatContextContent['side'];

export interface DiffSelectedLineRange {
  end: number;
  endSide?: DiffSelectionSide;
  side?: DiffSelectionSide;
  start: number;
}

interface ParsedDiffLine {
  content: string;
  lineNumber: number;
  order: number;
  selectionSide: DiffSelectionSide;
  side: CodeSelectionSide;
}

interface BuildCodeContextSelectionParams {
  filePath: string;
  language?: string;
  patch: string;
  range: DiffSelectedLineRange;
  workingDirectory: string;
}

const hunkHeaderRegExp = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const getRangeSideSet = (range: DiffSelectedLineRange): Set<DiffSelectionSide> => {
  const sides = new Set<DiffSelectionSide>();
  if (range.side) sides.add(range.side);
  if (range.endSide) sides.add(range.endSide);

  if (sides.size === 0) {
    sides.add('additions');
    sides.add('deletions');
  }

  return sides;
};

const parsePatchLines = (patch: string): ParsedDiffLine[] => {
  const lines: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let order = 0;

  for (const rawLine of patch.split('\n')) {
    const hunkMatch = hunkHeaderRegExp.exec(rawLine);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      continue;
    }

    if (rawLine.startsWith('---') || rawLine.startsWith('+++') || rawLine.startsWith('\\')) {
      continue;
    }

    const marker = rawLine[0];
    const content = marker === ' ' || marker === '+' || marker === '-' ? rawLine.slice(1) : rawLine;

    switch (marker) {
      case '+': {
        lines.push({
          content,
          lineNumber: newLine,
          order: order++,
          selectionSide: 'additions',
          side: 'additions',
        });
        newLine += 1;
        break;
      }

      case '-': {
        lines.push({
          content,
          lineNumber: oldLine,
          order: order++,
          selectionSide: 'deletions',
          side: 'deletions',
        });
        oldLine += 1;
        break;
      }

      case ' ': {
        lines.push(
          {
            content,
            lineNumber: oldLine,
            order,
            selectionSide: 'deletions',
            side: 'context',
          },
          {
            content,
            lineNumber: newLine,
            order,
            selectionSide: 'additions',
            side: 'context',
          },
        );
        order += 1;
        oldLine += 1;
        newLine += 1;
        break;
      }
    }
  }

  return lines;
};

const getCommonSide = (lines: ParsedDiffLine[]): CodeSelectionSide | undefined => {
  const [firstLine] = lines;
  if (!firstLine) return;

  return lines.every((line) => line.side === firstLine.side) ? firstLine.side : undefined;
};

export const buildCodeContextSelection = ({
  filePath,
  language,
  patch,
  range,
  workingDirectory,
}: BuildCodeContextSelectionParams): Omit<ChatContextContent, 'id' | 'type'> | undefined => {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const sides = getRangeSideSet(range);
  const selectedLines = parsePatchLines(patch)
    .filter(
      (line) => sides.has(line.selectionSide) && line.lineNumber >= start && line.lineNumber <= end,
    )
    .sort((a, b) => a.order - b.order || a.lineNumber - b.lineNumber);

  if (selectedLines.length === 0) return;

  const dedupedLines = selectedLines.filter((line, index, lines) => {
    const previous = lines[index - 1];
    return (
      !previous ||
      previous.order !== line.order ||
      previous.content !== line.content ||
      previous.lineNumber !== line.lineNumber
    );
  });

  const lineNumbers = dedupedLines.map((line) => line.lineNumber);
  const lineRange = {
    endLine: Math.max(...lineNumbers),
    startLine: Math.min(...lineNumbers),
  };
  const content = dedupedLines
    .map((line) => line.content)
    .join('\n')
    .trimEnd();

  if (!content.trim()) return;

  return {
    content,
    filePath,
    language,
    lineRange,
    preview: `${filePath}:${lineRange.startLine}-${lineRange.endLine}`,
    side: getCommonSide(dedupedLines),
    source: 'code',
    title: `${filePath}:${lineRange.startLine}-${lineRange.endLine}`,
    workingDirectory,
  };
};
