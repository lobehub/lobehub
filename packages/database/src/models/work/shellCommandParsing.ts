/**
 * Command-agnostic shell command parsing shared by the shell-Work normalizers
 * (github today; any future CLI whose runs should register Works). Everything
 * here is about turning raw shell command TEXT into simple-command token
 * segments — nothing in this module knows about `gh` or any other CLI.
 */

const CONTROL_OPERATORS = new Set(['&&', '||', ';', '|', '&']);

/**
 * Minimal POSIX-ish tokenizer: whitespace splitting with single/double quote
 * and backslash handling. Returns null on unterminated quotes — better to
 * skip registration than to mis-attribute flag values.
 *
 * Deliberately hand-rolled instead of adding a `shell-quote`-style dependency:
 * a real shell parser would also expand what we must keep literal (`$VAR`,
 * globs) and adds a dependency to the database package for a best-effort
 * bookkeeping path whose worst failure mode is skipping a Work registration.
 * Known trade-off: quoting is stripped before operator splitting, so a quoted
 * literal like `--title '&&'` is treated as a control operator and at worst
 * truncates the parsed segment. Edge cases are pinned in
 * `__tests__/githubToolResult.test.ts`.
 */
const tokenizeShellCommand = (input: string): string[] | null => {
  const tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let i = 0;

  const push = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) return null;
      current += input.slice(i + 1, end);
      hasCurrent = true;
      i = end + 1;
    } else if (ch === '"') {
      i++;
      let closed = false;
      while (i < input.length) {
        const c = input[i];
        if (c === '\\' && '"\\$`'.includes(input[i + 1] ?? '')) {
          current += input[i + 1];
          i += 2;
        } else if (c === '"') {
          closed = true;
          i++;
          break;
        } else {
          current += c;
          i++;
        }
      }
      if (!closed) return null;
      hasCurrent = true;
    } else if (ch === '\\') {
      // Backslash-newline is a line continuation; otherwise escape the next char.
      if (input[i + 1] === '\n') {
        i += 2;
      } else {
        current += input[i + 1] ?? '';
        hasCurrent = true;
        i += 2;
      }
    } else if (/\s/.test(ch)) {
      push();
      i++;
    } else {
      current += ch;
      hasCurrent = true;
      i++;
    }
  }

  push();
  return tokens;
};

/** Split a token stream on whitespace-separated shell control operators. */
const splitCommandSegments = (tokens: string[]): string[][] => {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (CONTROL_OPERATORS.has(token)) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) segments.push(current);
  return segments;
};

/**
 * Codex `command_execution` records the spawn argv verbatim, and codex wraps
 * every command in a login shell — `/bin/zsh -lc '<real command>'` (see the
 * adapter fixtures in `heterogeneous-agents/src/adapters/codex.test.ts`). Such
 * a segment's first token is the shell path, not the CLI binary, so the `-c`
 * payload is re-tokenized and re-split (exactly what `-c` itself does) IN
 * PLACE of the wrapper segment — outer segments around it (`bash -c 'git push'
 * && gh pr create ...`) are preserved by the caller's flatMap. Non-wrapper
 * segments (`bash ./prepare.sh`) pass through untouched; a payload with
 * unterminated quoting drops only its own segment.
 */
const expandShellWrapperSegment = (segment: string[]): string[][] => {
  const shell = segment[0]?.split('/').pop();
  if (!shell || !/^(?:ba|da|k)?sh$|^zsh$/.test(shell)) return [segment];

  // Skip option flags; `-c` (possibly bundled, e.g. `-lc`) marks the first
  // non-flag token as the command string. Positionals after it are $0/$1
  // arguments, never part of the command text.
  let hasCommandFlag = false;
  for (let i = 1; i < segment.length; i++) {
    const token = segment[i];
    if (/^-[A-Z]+$/i.test(token)) {
      if (token.includes('c')) hasCommandFlag = true;
      continue;
    }
    if (!hasCommandFlag) return [segment];
    const payload = tokenizeShellCommand(token);
    return payload ? splitCommandSegments(payload) : [];
  }
  return [segment];
};

/**
 * Parse raw shell command text into simple-command token segments: tokenize,
 * split on control operators, and expand login-shell `-c` wrappers in place.
 * Returns null when the text cannot be tokenized (unterminated quoting).
 */
export const parseShellCommandSegments = (command: string): string[][] | null => {
  const tokens = tokenizeShellCommand(command);
  if (!tokens) return null;

  return splitCommandSegments(tokens).flatMap(expandShellWrapperSegment);
};
