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

interface RunCommandOutputState {
  output?: string;
  stderr?: string;
  stdout?: string;
}

/**
 * The text a command card shows as the command's own output, next to a
 * separately rendered `stderr`.
 *
 * `stdout` is the canonical field. Writers stopped persisting `output` when it
 * only repeats `stdout` (Codex) or `stdout + stderr` (local shell), so newer
 * rows carry `stdout` alone while older rows carry both; legacy rows and
 * backends that never report `stdout` still fall back to `output`, then to the
 * tool message body.
 *
 * An empty `stdout` next to a non-empty `stderr` yields no text: the legacy
 * `output` would only repeat the stderr block the card already renders.
 */
export const getRunCommandStdout = (
  state: RunCommandOutputState | null | undefined,
  content?: string | null,
): string => {
  if (typeof state?.stdout === 'string') {
    if (state.stdout) return state.stdout;
    if (state.stderr?.trim()) return '';
  }

  return state?.output || content || '';
};
