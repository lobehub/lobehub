import { withoutShellSetup } from './readableShellCommand';
import type { ShellCommandAction } from './types';

type ScriptAction = Extract<ShellCommandAction, `runScript.${string}`>;

/**
 * What the first statement of a command does when it is a script the agent
 * wrote inline (`python3 - <<'EOF'`, `node -e '...'`) or a file it writes from
 * a heredoc (`cat > notes.md <<'EOF'`). `rest` is whatever follows that
 * statement; `note` is the comment that opens a script, when it has one.
 *
 * Ported from Caxri (`packages/protocol/src/agent/tool-rows/shell/agent-shell-script.ts`).
 */
export type ShellScriptStep =
  | { action: ScriptAction; kind: 'script'; note?: string; rest?: string }
  | { kind: 'write'; path: string; rest?: string };

const INTERPRETER_ACTIONS: Readonly<Partial<Record<string, ScriptAction>>> = {
  bash: 'runScript.shell',
  bun: 'runScript.bun',
  node: 'runScript.node',
  perl: 'runScript.perl',
  python: 'runScript.python',
  ruby: 'runScript.ruby',
  sh: 'runScript.shell',
  zsh: 'runScript.shell',
};

/**
 * An interpreter, optionally by path or behind `uv run` and its options:
 * `python3`, `/usr/bin/python3.12`, `uv run --with rich python`.
 */
const INTERPRETER = String.raw`(?:uv\s+run\s+(?:-[\w-]+(?:[= ][^\s;&|<>-]\S*)?\s+)*)?(?:\S*\/)?(?<name>python|python3(?:\.\d+)?|node|bun|ruby|perl|bash|sh|zsh)`;

/** One argument word that cannot start a redirection or end the statement (`-I`, `-`, `"$f"`). */
const ARGUMENT = String.raw`(?:'[^']*'|"[^"]*"|[^\s;&|<>'"]+)`;

/**
 * A heredoc opener and the rest of its line. The delimiter is any shell word
 * (`EOF`, `END-JSON`, `\EOF`), so the classifier agrees with the title cleaner
 * about where a heredoc ends.
 */
const HEREDOC = String.raw`<<-?\s*(?<quote>['"]?)\\?(?<tag>[^\s'"<>;&|()\\]+)\k<quote>(?<after>[^\n]*)\n`;

const SCRIPT_HEREDOC = new RegExp(String.raw`^${INTERPRETER}(?:\s+${ARGUMENT})*\s*${HEREDOC}`, 'u');

/**
 * A script passed as one quoted argument: `python3 -c '...'`, `node -e "..."`.
 * A shell's `-c` only wraps another command, so `bash -c` is not a script here.
 */
const SCRIPT_INLINE = new RegExp(
  String.raw`^${INTERPRETER}(?:\s+-[\w-]+)*\s+-[ce]\s+(?:'[^']*'|"(?:[^"\\]|\\.)*")`,
  'u',
);

const WRITE_PATH = String.raw`(?<path>'[^']*'|"[^"]*"|[^\s;&|<>'"]+)`;

/** A heredoc written to a file: `cat > notes.md <<'EOF'`, `cat <<EOF >> log.md`, `tee -a notes.md <<EOF`. */
const WRITE_HEREDOCS = [
  new RegExp(String.raw`^cat\s*>>?\s*${WRITE_PATH}\s*${HEREDOC}`, 'u'),
  new RegExp(
    String.raw`^cat\s*<<-?\s*(?<quote>['"]?)\\?(?<tag>[^\s'"<>;&|()\\]+)\k<quote>\s*>>?\s*${WRITE_PATH}(?<after>(?:[\s;&|<>][^\n]*)?)\n`,
    'u',
  ),
  new RegExp(String.raw`^tee\s+(?:-a\s+)?${WRITE_PATH}(?:\s*>\s*\/dev\/null)?\s*${HEREDOC}`, 'u'),
];

/**
 * The text after a statement, without the `&&`, `;`, or newline that separates
 * it, or `undefined` when nothing follows. An `echo` that only marks progress
 * (`echo done`, `echo ---`) is not worth a title either.
 */
const restAfter = (text: string): string | undefined => {
  const rest = text
    .replace(/^\s*(?:&&|;)?\s*/u, '')
    .replace(/^(?:echo\s+(?:[^\s$&;<>`|][^\n$&;<>`|]*)?(?:&&|;|\n)\s*)+/u, '')
    .trim();
  if (rest === '') return undefined;
  const isOnlyEchoes = rest
    .split(/&&|;|\n/u)
    .every((statement) => /^\s*(?:echo\s[^$<>`|]*)?$/u.test(statement));
  return isOnlyEchoes ? undefined : rest;
};

/**
 * A heredoc's body and what follows its terminator line, with anything after
 * the opener that chains another command (`<<'EOF' && echo ok`) kept in front.
 * A pipe or redirection after the opener only shapes the output and is dropped.
 * An unterminated (still streaming) heredoc yields `undefined`.
 */
const heredocParts = (
  text: string,
  match: RegExpExecArray,
): { body: string[]; rest?: string } | undefined => {
  const { tag = '', after = '' } = match.groups ?? {};
  const lines = text.slice(match[0].length).split('\n');
  const end = lines.findIndex((line) => line.trim() === tag);
  if (end === -1) return undefined;
  const chained = /^\s*(?:&&|;)/u.test(after) ? `${after}\n` : '';
  const rest = restAfter(`${chained}${lines.slice(end + 1).join('\n')}`);
  return { body: lines.slice(0, end), ...(rest !== undefined && { rest }) };
};

/** The comment a script opens with (`# Count the rows per session`), which says what it does better than its language. */
const scriptNote = (body: readonly string[]): string | undefined => {
  const first = body.find((line) => line.trim() !== '')?.trim() ?? '';
  const note = /^(?:#(?!!)|\/\/)\s*(?<text>\S.*)$/u.exec(first)?.groups?.text.trim();
  return note || undefined;
};

const unquoted = (word: string): string =>
  /^(["'])[\s\S]*\1$/u.test(word) ? word.slice(1, -1) : word;

const interpreterAction = (name: string | undefined): ScriptAction | undefined =>
  INTERPRETER_ACTIONS[(name ?? '').replace(/3(?:\.\d+)?$/u, '')];

/**
 * Reads the first real statement of a command (after setup such as `cd`) as an
 * inline script or a heredoc file write. Anything else, including a script file
 * run by path (`python3 tool.py`), returns `null`.
 */
export const describeShellScript = (command: string): ShellScriptStep | null => {
  const text = withoutShellSetup(command);
  const heredoc = SCRIPT_HEREDOC.exec(text);
  if (heredoc) {
    const action = interpreterAction(heredoc.groups?.name);
    const parts = action && heredocParts(text, heredoc);
    if (!action || !parts) return null;
    const note = scriptNote(parts.body);
    return {
      action,
      kind: 'script',
      ...(note !== undefined && { note }),
      ...(parts.rest !== undefined && { rest: parts.rest }),
    };
  }
  const inline = SCRIPT_INLINE.exec(text);
  const inlineName = inline?.groups?.name ?? '';
  if (inline && !['bash', 'sh', 'zsh'].includes(inlineName)) {
    const action = interpreterAction(inlineName);
    if (!action) return null;
    // Arguments, pipes, and redirections after the script stay part of its statement.
    const separator = /^[^\n"&';]*(?:&&|;|\n)/u.exec(text.slice(inline[0].length));
    const rest = separator && restAfter(text.slice(inline[0].length + separator[0].length));
    return { action, kind: 'script', ...(rest && { rest }) };
  }
  for (const pattern of WRITE_HEREDOCS) {
    const write = pattern.exec(text);
    const parts = write && heredocParts(text, write);
    if (!write || !parts) continue;
    const path = unquoted(write.groups?.path ?? '');
    return { kind: 'write', path, ...(parts.rest !== undefined && { rest: parts.rest }) };
  }
  return null;
};
