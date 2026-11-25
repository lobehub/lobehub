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
 * An empty `stdout` keeps falling back even when `stderr` is set: the body
 * carries the exit code and failure header (e.g. a stderr-only non-zero exit),
 * which the card would otherwise not show anywhere. A legacy `output` that is
 * exactly `stderr` is skipped for the same reason: it only repeats the stderr
 * block and would hide that header.
 */
export const getRunCommandStdout = (
  state: RunCommandOutputState | null | undefined,
  content?: string | null,
): string => {
  const output = state?.output === state?.stderr ? undefined : state?.output;

  return state?.stdout || output || content || '';
};
