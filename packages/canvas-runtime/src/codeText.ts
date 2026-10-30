export const normalizeCodeText = (text: string) => {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();

  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== '').map((line) => /^[\t ]*/.exec(line)![0].length),
  );
  return Number.isFinite(indent) && indent > 0
    ? lines.map((line) => line.slice(Math.min(indent, /^[\t ]*/.exec(line)![0].length))).join('\n')
    : lines.join('\n');
};
