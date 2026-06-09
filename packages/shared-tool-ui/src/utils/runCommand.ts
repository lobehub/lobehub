const SHELL_WRAPPER_PATTERN =
  /^(?:\/usr\/bin\/env\s+)?(?:\/\S+\/)?(?:bash|sh|zsh)\s+(?:-lc|-c|-l\s+-c)\s+(\S[\s\S]*)$/;

const stripOuterShellQuotes = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;

  const body = trimmed.slice(1, -1);
  if (quote === "'") return body.replaceAll("'\\''", "'");

  return body
    .replaceAll('\\"', '"')
    .replaceAll('\\`', '`')
    .replaceAll('\\$', '$')
    .replaceAll('\\\\', '\\');
};

export const getRunCommandDisplayCommand = (command?: string) => {
  const trimmed = command?.trim() || '';
  if (!trimmed) return '';

  const match = trimmed.match(SHELL_WRAPPER_PATTERN);
  if (!match) return trimmed;

  return stripOuterShellQuotes(match[1]) || trimmed;
};
