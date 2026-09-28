export interface ParsedCommandInput {
  args: string[];
  command: string;
}

const tokenize = (input: string): string[] =>
  (input.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    /^(["']).*\1$/.test(token) ? token.slice(1, -1) : token,
  );

export const parseCommandInput = (raw: string): ParsedCommandInput | null => {
  const trimmed = raw.trim();
  if (!trimmed || !/\s/.test(trimmed)) return null;

  const [command, ...args] = tokenize(trimmed);
  if (!command) return null;

  return { args, command };
};
