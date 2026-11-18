import { getRunCommandDisplayCommand } from '@lobechat/shared-tool-ui/run-command';

/**
 * Turns a raw shell command into the one-line title of a tool row that has no
 * model-written description. The expanded row still shows the exact command.
 *
 * Ported from Caxri's `readableShellCommand`
 * (`packages/protocol/src/agent/tool-rows/shell/agent-shell-title.ts`), with
 * three additions: `set -a` / `set +a` count as setup, multi-line commands are
 * joined into one line, and a heredoc whose body is still streaming is cut at
 * its opener line instead of leaking the partial script into the title.
 */

/**
 * Plumbing an agent appends only to keep its own output short (`2>&1`,
 * `2>/dev/null`, a trailing `| head -30`) says nothing about what the command
 * does, yet fills a one-line title. Dropped at each command boundary.
 */
const SHELL_TITLE_NOISE =
  /\s*(?:\d?>&\d|&?\d?>\s*\/dev\/null|\|\s*(?:head|tail)(?:\s+-n)?(?:\s+-?\d+)?)(?=[ \t]*(?:;|&&|\|\||\n|$))/gu;

/**
 * One shell word, quotes and escapes included (`"agent-browser --session $S"`,
 * `Application\ Support`), never crossing an unquoted `;`, `&`, or `|`.
 */
const SHELL_WORD = String.raw`(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s;&|'"\\])+`;
const SHELL_VALUE = SHELL_WORD.replace(/\+$/u, '*');
const SHELL_ASSIGNMENTS = String.raw`[A-Za-z_]\w*=${SHELL_VALUE}(?:\s+[A-Za-z_]\w*=${SHELL_VALUE})*`;

/**
 * A statement that only prepares the command after it, ending in `&&`, `;`, or
 * a newline: `cd <dir>`, variable assignments, `export`, `set -a`, a fixed
 * `sleep`, `mkdir -p`, or sourcing a file (`. lib.sh`, `source .env`). A leading
 * `cd` alone opens most undescribed agent commands, so without this every title
 * reads as the same worktree path.
 */
const SHELL_TITLE_SETUP = new RegExp(
  String.raw`^\s*(?:cd\s+${SHELL_WORD}|(?:export\s+)?${SHELL_ASSIGNMENTS}|set\s+[+-]a|sleep\s+\d+(?:\.\d+)?|mkdir\s+-p(?:\s+${SHELL_WORD})+|(?:\.|source)\s+${SHELL_WORD})[ \t]*(?:&&|;|\n)\s*`,
  'u',
);

const SHELL_ASSIGNMENT = new RegExp(String.raw`([A-Za-z_]\w*)=(${SHELL_WORD})?`, 'gu');

/**
 * A heredoc delimiter: any shell word, so `END-JSON` and `PY.END` count as
 * well as `EOF`, quoted (`'EOF'`) or escaped (`\EOF`). Named groups keep it embeddable in larger patterns.
 */
const HEREDOC_TAG = String.raw`(?<quote>['"]?)\\?([^\s'"<>;&|()\\]+)\k<quote>`;

/** A heredoc opener (`<<'EOF'`, `<<-PY`); its body is input, not the command. */
const HEREDOC_OPENER = new RegExp(String.raw`(?<!<)<<(?!<)-?\s*${HEREDOC_TAG}`, 'u');

/** A heredoc inside a command substitution: `"$(cat <<'EOF'`. */
const HEREDOC_SUBSTITUTION = new RegExp(
  String.raw`"?\$\(\s*cat\s+<<(?!<)-?\s*${HEREDOC_TAG}[ \t]*\n`,
  'u',
);

/**
 * Quoted text on its own (`'<<EOF'`, `'a | head -5; b'`), skipping a quoted
 * heredoc delimiter (`<<'EOF'`) so the opener still reads as one.
 */
const QUOTED_TEXT = new RegExp(
  String.raw`((?<!<)<<(?!<)-?\s*${HEREDOC_TAG})|'[^']*'|"(?:[^"\\]|\\.)*"`,
  'gu',
);

/**
 * Hides quoted text behind private-use placeholders, so the rules below only
 * read real shell syntax: a `|`, `;`, or `<<` inside quotes is an argument.
 * `restore` puts the original text back.
 */
const maskQuotedText = (text: string): { masked: string; restore: (value: string) => string } => {
  const quoted: string[] = [];
  const masked = text.replaceAll(QUOTED_TEXT, (whole, opener?: string) => {
    if (opener) return whole;
    quoted.push(whole);
    return `\uE000${quoted.length - 1}\uE001`;
  });
  const restore = (value: string) =>
    value.replaceAll(/\uE000(\d+)\uE001/gu, (_, index: string) => quoted[Number(index)] ?? '');
  return { masked, restore };
};

const unquoteShellWord = (word: string): string =>
  /^(["'])[\s\S]*\1$/u.test(word) ? word.slice(1, -1) : word;

/**
 * Replaces `"$(cat <<'EOF' … EOF\n)"` with the quoted first body line, so a
 * commit message reads as `git commit -m 'fix: …'`. An unterminated one is left
 * for {@link withoutHeredocBodies} to cut.
 */
export const inlineHeredocSubstitutions = (command: string): string => {
  let rest = command;
  let result = '';
  for (
    let start = HEREDOC_SUBSTITUTION.exec(rest);
    start;
    start = HEREDOC_SUBSTITUTION.exec(rest)
  ) {
    const tag = start[2];
    const bodyStart = start.index + start[0].length;
    const lines = rest.slice(bodyStart).split('\n');
    const endLine = lines.findIndex((line) => line.trim() === tag);
    if (endLine === -1) return command;
    const close = /^\s*\)"?/u.exec(lines.slice(endLine + 1).join('\n'));
    if (!close) return command;
    const firstLine = lines.slice(0, endLine).find((line) => line.trim() !== '') ?? '';
    const consumed = lines.slice(0, endLine + 1).join('\n').length + 1 + close[0].length;
    result += `${rest.slice(0, start.index)}'${firstLine.trim().replaceAll("'", '')}'`;
    rest = rest.slice(bodyStart + consumed);
  }
  return result + rest;
};

/**
 * Drops every heredoc body, keeping the line that opens it
 * (`python3 - <<'EOF'`, `cat > notes.md <<'EOF'`). A heredoc whose terminator
 * has not arrived yet (still streaming) ends the command at its opener line.
 */
const withoutHeredocBodies = (command: string): string => {
  const lines = command.split('\n');
  const kept: string[] = [];
  // The quote a previous line left open (`python3 -c '` …), so a `<<` inside a
  // multi-line quoted argument is not read as a heredoc.
  let openQuote: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    kept.push(line);
    let code = line;
    if (openQuote) {
      const close = line.indexOf(openQuote);
      if (close === -1) continue;
      code = line.slice(close + 1);
      openQuote = undefined;
    }
    const masked = maskQuotedText(code).masked;
    const stray = /['"]/u.exec(masked.replaceAll(new RegExp(HEREDOC_OPENER, 'gu'), ''));
    if (stray) {
      openQuote = stray[0];
      continue;
    }
    const tag = HEREDOC_OPENER.exec(masked)?.[2];
    if (!tag) continue;
    const end = lines.findIndex((candidate, at) => at > index && candidate.trim() === tag);
    if (end === -1) break;
    index = end;
  }
  return kept.join('\n');
};

/**
 * Strips the setup statements that open a command while a command still
 * follows them (so `cd src` alone keeps its title), collecting the variables
 * they assign.
 */
const stripShellSetup = (
  command: string,
  restore: (value: string) => string,
): { rest: string; variables: Map<string, string> } => {
  let rest = command;
  const variables = new Map<string, string>();
  for (let match = SHELL_TITLE_SETUP.exec(rest); match; match = SHELL_TITLE_SETUP.exec(rest)) {
    const remaining = rest.slice(match[0].length);
    if (remaining.trim() === '') break;
    const statement = match[0];
    if (!/^\s*(?:cd|set|sleep|mkdir|\.|source)\s/u.test(statement)) {
      for (const [, name = '', value = ''] of statement.matchAll(SHELL_ASSIGNMENT))
        variables.set(name, unquoteShellWord(restore(value)));
    }
    rest = remaining;
  }
  return { rest, variables };
};

/**
 * An agent driving a CLI repeatedly names it once
 * (`A="agent-browser --session $S"; $A click @e25`). With the assignment
 * dropped, a command that starts with that variable reads as its value again;
 * a variable used as an argument stays as written.
 */
const expandCommandVariables = (command: string, variables: ReadonlyMap<string, string>) => {
  if (variables.size === 0) return command;
  return command.replaceAll(
    /(^|&&|[;\n|])(\s*)\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))(?![\w{])/gu,
    (whole, separator: string, space: string, braced?: string, bare?: string) => {
      const value = variables.get(braced ?? bare ?? '');
      return value ? `${separator}${space}${value}` : whole;
    },
  );
};

/**
 * Joins a multi-line command into one line: a line ending in an operator or a
 * block opener (`do`, `then`, `{`, `|`, `&&`) continues on the next one,
 * otherwise the lines are separate statements joined with `; `.
 */
const joinLines = (command: string): string => {
  const lines = command
    .replaceAll(/[ \t]*\\\n\s*/gu, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let joined = '';
  for (const line of lines) {
    if (!joined) joined = line;
    else if (/(?:[;&|{(]|\b(?:do|then|else|in))$/u.test(joined)) joined += ` ${line}`;
    else joined += `; ${line}`;
  }
  return joined;
};

export const readableShellCommand = (rawCommand: string): string => {
  const command = getRunCommandDisplayCommand(rawCommand);
  const bodiless = withoutHeredocBodies(inlineHeredocSubstitutions(command));
  // Every rule below reads shell syntax, so quoted arguments stay out of reach.
  const { masked, restore } = maskQuotedText(bodiless);
  const { rest, variables } = stripShellSetup(masked, restore);
  let readable = expandCommandVariables(rest, variables);
  // Stripping `| tail -1` leaves the `2>&1` before it at the end of its
  // command, so repeat until nothing changes.
  for (let previous = ''; previous !== readable;) {
    previous = readable;
    readable = readable.replaceAll(SHELL_TITLE_NOISE, '');
  }
  // A multi-line quoted argument still reads as one line.
  return restore(joinLines(readable)).replaceAll(/\s*\n\s*/gu, ' ') || command.trim();
};

/**
 * The command after the setup statements that open it, heredoc bodies kept,
 * for a reader that classifies what the first real statement does
 * (`python3 - <<'EOF'` after `cd /work/repo &&`).
 */
export const withoutShellSetup = (rawCommand: string): string => {
  const command = inlineHeredocSubstitutions(getRunCommandDisplayCommand(rawCommand));
  const { masked, restore } = maskQuotedText(command);
  return restore(stripShellSetup(masked, restore).rest);
};
