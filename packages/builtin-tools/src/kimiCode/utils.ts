export const countChangedLines = (oldText: string, newText: string) => {
  if (oldText === newText) return { linesAdded: 0, linesDeleted: 0 };

  return {
    linesAdded: newText ? newText.split('\n').length : 0,
    linesDeleted: oldText ? oldText.split('\n').length : 0,
  };
};

export const stripKimiLineNumbers = (content: string): string =>
  content
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
