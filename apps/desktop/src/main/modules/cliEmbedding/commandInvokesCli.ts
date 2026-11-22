import path from 'node:path';

import { getCliWrapperDir } from './generateCliWrapper';

/** Cheap pre-check, so ordinary commands never have to resolve the wrapper directory. */
const LH_PATH_TAIL = /[/\\]lh(?:\.cmd)?(?![\w-])/;
const MAX_NESTED_SHELLS = 3;

/** Text right before the script argument of `sh -c`, `bash -lc`, `zsh -c` and the like. */
const SHELL_SCRIPT_FLAG =
  /(?:^|[\s/\\])(?:ba|da|k|z)?sh(?:\.exe)?(?:[\t ]+-\w+)*[\t ]+-\w*c[\t ]*$/;
const HEREDOC = /^<<-?[\t ]*(?:'([^']+)'|"([^"]+)"|\\?([^\s;&|<>()]+))/;

/** What may stand between the start of a simple command and the program it runs. */
const COMMAND_PREFIX = [
  String.raw`(?:(?:do|then|else|if|elif|while|until)[\t ]+)*`,
  String.raw`(?:(?:!|time|command|exec|nohup|nice|env|xargs|timeout)`,
  String.raw`(?:[\t ]+(?:-\S+|\d\S*|[A-Za-z_]\w*=\S*))*[\t ]+|[A-Za-z_]\w*=\S*[\t ]+)*`,
].join('');
const LH_INVOCATION = new RegExp(
  String.raw`(?:^|[\n;&|(){])[\t ]*${COMMAND_PREFIX}lh(?=[\s;&|)]|$)`,
);

const readDoubleQuoted = (source: string, start: number) => {
  const substitutions: string[] = [];
  let body = '';
  let i = start + 1;
  while (i < source.length && source[i] !== '"') {
    if (source[i] === '\\') {
      body += source.slice(i, i + 2);
      i += 2;
    } else if (source.startsWith('$(', i)) {
      let depth = 1;
      let end = i + 2;
      for (; end < source.length && depth > 0; end++) {
        if (source[end] === '(') depth++;
        else if (source[end] === ')') depth--;
      }
      substitutions.push(source.slice(i + 2, end - 1));
      body += source.slice(i, end);
      i = end;
    } else if (source[i] === '`') {
      const close = source.indexOf('`', i + 1);
      const end = close < 0 ? source.length : close;
      substitutions.push(source.slice(i + 1, end));
      body += source.slice(i, end + 1);
      i = end + 1;
    } else {
      body += source[i];
      i++;
    }
  }
  return { body, end: i + 1, substitutions };
};

/** First index after the heredoc bodies that start at the line after `newline`. */
const skipHeredocs = (source: string, newline: number, delimiters: string[]) => {
  let lineStart = newline + 1;
  for (const delimiter of delimiters) {
    while (lineStart < source.length) {
      const lineEnd = source.indexOf('\n', lineStart);
      const end = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(lineStart, end);
      lineStart = end + 1;
      if (line.trim() === delimiter) break;
    }
  }
  return lineStart;
};

/**
 * The command with everything the shell will not execute blanked out: quoted
 * text, comments and heredoc bodies. Scripts that do run from inside quotes
 * (`bash -c '…'`, `"$(…)"`, backticks) are returned separately.
 */
const maskInertText = (source: string) => {
  const nested: string[] = [];
  const heredocs: string[] = [];
  let code = '';
  let i = 0;

  const addQuoted = (body: string) => {
    if (SHELL_SCRIPT_FLAG.test(code)) nested.push(body);
    code += body === 'lh' || body === 'lh.cmd' ? 'lh' : '_';
  };

  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      code += source[i + 1] === '\n' ? ' ' : '_';
      i += 2;
    } else if (char === "'") {
      const close = source.indexOf("'", i + 1);
      const end = close < 0 ? source.length : close;
      addQuoted(source.slice(i + 1, end));
      i = end + 1;
    } else if (char === '"') {
      const { body, end, substitutions } = readDoubleQuoted(source, i);
      nested.push(...substitutions);
      addQuoted(body);
      i = end;
    } else if (char === '`') {
      const close = source.indexOf('`', i + 1);
      const end = close < 0 ? source.length : close;
      nested.push(source.slice(i + 1, end));
      code += '_';
      i = end + 1;
    } else if (char === '#' && (i === 0 || /[\s;&|(]/.test(source[i - 1]))) {
      const newline = source.indexOf('\n', i);
      i = newline < 0 ? source.length : newline;
    } else if (char === '<' && source[i + 1] === '<' && source[i + 2] !== '<') {
      const match = HEREDOC.exec(source.slice(i));
      if (match) heredocs.push(match[1] ?? match[2] ?? match[3]);
      code += ' ';
      i += match?.[0].length ?? 2;
    } else if (char === '\n' && heredocs.length > 0) {
      i = skipHeredocs(source, i, heredocs.splice(0));
      code += '\n';
    } else {
      code += char;
      i++;
    }
  }
  return { code, nested };
};

/** Reads the bundled wrapper's absolute path, quoted or shell-escaped, as plain `lh`. */
const withWrapperAsLh = (command: string) => {
  if (!LH_PATH_TAIL.test(command)) return command;
  const wrapper = path.join(getCliWrapperDir(), 'lh');
  const unescaped = command.replaceAll('\\ ', ' ');
  if (!unescaped.includes(wrapper)) return command;
  return unescaped.replaceAll(`${wrapper}.cmd`, 'lh').replaceAll(wrapper, 'lh');
};

const invokesLh = (script: string, depth: number): boolean => {
  const { code, nested } = maskInertText(script);
  if (LH_INVOCATION.test(code)) return true;
  return depth < MAX_NESTED_SHELLS && nested.some((inner) => invokesLh(inner, depth + 1));
};

/**
 * Whether a command actually runs `lh` somewhere past its first word:
 * `cd x && lh …`, `export PATH=… && lh …`, `timeout 60 lh …`, `bash -lc 'lh …'`,
 * `out=$(lh …)`, or the bundled wrapper by its absolute path.
 *
 * A match puts the app's token in the environment of the whole command, so text
 * that merely mentions `lh` must not count: `printf 'lh\n'; env` would print the
 * token. Only `lh` is recognized, because `lobe` and `lobehub` are everyday words
 * in paths and package names.
 */
export const commandInvokesEmbeddedCli = (command: string): boolean =>
  invokesLh(withWrapperAsLh(command), 0);
