const SHELL_WRAPPER_PATTERN =
  /^(?:\/usr\/bin\/env\s+)?(?:\/\S+\/)?(?:bash|sh|zsh)\s+(?:-lc|-c|-l\s+-c)\s+(\S[\s\S]*)$/;

const CAT_OPTION_PATTERN = /^-[a-z]+$/i;
const SED_RANGE_PATTERN = /^(\d+)(?:,(\d+))?p$/;

const hasShellControlOperator = (value: string) =>
  /\|\||&&|[|;<>`]/.test(value) || value.includes('$(');

const hasUnsafeShellControlOperator = (value: string) =>
  /\|\||&&|[;<>`]/.test(value) || value.includes('$(');

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

const stripShellWrapper = (command?: string) => {
  const trimmed = command?.trim() || '';
  if (!trimmed) return '';

  const match = trimmed.match(SHELL_WRAPPER_PATTERN);
  if (!match) return trimmed;

  return stripOuterShellQuotes(match[1]) || trimmed;
};

const pushToken = (tokens: string[], token: string) => {
  if (token) tokens.push(token);
};

const tokenizeShellLike = (command: string): string[] | undefined => {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '|') {
      pushToken(tokens, current);
      current = '';
      tokens.push('|');
      continue;
    }

    if (/\s/.test(char)) {
      pushToken(tokens, current);
      current = '';
      continue;
    }

    current += char;
  }

  if (quote || escaping) return;
  pushToken(tokens, current);

  return tokens;
};

const parseLineRange = (range: string) => {
  const match = range.match(SED_RANGE_PATTERN);
  if (!match) return;

  return {
    endLine: match[2] ? Number(match[2]) : undefined,
    startLine: Number(match[1]),
  };
};

const getSingleFileToken = (token?: string) => {
  if (!token || token === '-' || hasShellControlOperator(token)) return;
  return token;
};

export interface CodexReadFileCommandDisplay {
  endLine?: number;
  filePath: string;
  startLine?: number;
}

const parseSedReadCommand = (tokens: string[]): CodexReadFileCommandDisplay | undefined => {
  if (tokens[0] !== 'sed') return;

  const printOption = tokens[1];
  if (printOption !== '-n' && printOption !== '--quiet' && printOption !== '--silent') return;

  const range = parseLineRange(tokens[2] || '');
  if (!range) return;

  const targetIndex = tokens[3] === '--' ? 4 : 3;
  if (tokens.length !== targetIndex + 1) return;

  const filePath = getSingleFileToken(tokens[targetIndex]);
  if (!filePath) return;

  return { ...range, filePath };
};

const parseCatReadCommand = (tokens: string[]): CodexReadFileCommandDisplay | undefined => {
  if (tokens[0] !== 'cat') return;

  let targetIndex = 1;
  while (CAT_OPTION_PATTERN.test(tokens[targetIndex] || '')) targetIndex += 1;
  if (tokens[targetIndex] === '--') targetIndex += 1;
  if (tokens.length !== targetIndex + 1) return;

  const filePath = getSingleFileToken(tokens[targetIndex]);
  if (!filePath) return;

  return { filePath };
};

export const getCodexReadFileCommandDisplay = (
  command?: string,
): CodexReadFileCommandDisplay | undefined => {
  const displayCommand = stripShellWrapper(command);
  if (!displayCommand || hasShellControlOperator(displayCommand)) return;

  const tokens = tokenizeShellLike(displayCommand);
  if (!tokens) return;

  return parseSedReadCommand(tokens) || parseCatReadCommand(tokens);
};

const RG_OPTIONS_WITH_VALUE = new Set([
  '-A',
  '-B',
  '-C',
  '-g',
  '-m',
  '-t',
  '-T',
  '--after-context',
  '--before-context',
  '--colors',
  '--context',
  '--context-separator',
  '--engine',
  '--field-context-separator',
  '--field-match-separator',
  '--glob',
  '--iglob',
  '--json-seq',
  '--max-columns',
  '--max-count',
  '--max-depth',
  '--max-filesize',
  '--mmap',
  '--path-separator',
  '--pre',
  '--replace',
  '--sort',
  '--sortr',
  '--type',
  '--type-add',
  '--type-clear',
  '--type-not',
]);

const RG_PATTERN_OPTIONS = new Set(['-e', '--regexp']);

const splitRgPipeline = (tokens: string[]) => {
  const pipeIndexes = tokens.reduce<number[]>((indexes, token, index) => {
    if (token === '|') indexes.push(index);
    return indexes;
  }, []);

  if (pipeIndexes.length === 0) return [tokens];
  if (pipeIndexes.length > 1) return;

  const pipeIndex = pipeIndexes[0];
  const first = tokens.slice(0, pipeIndex);
  const second = tokens.slice(pipeIndex + 1);

  if (first[0] !== 'rg' || second[0] !== 'rg' || !first.includes('--files')) return;

  return [second];
};

const getAttachedRgPattern = (token: string) => {
  if (token.startsWith('--regexp=')) return token.slice('--regexp='.length);
  if (token.startsWith('-e') && token.length > 2) return token.slice(2);
};

const isRgOptionWithAttachedValue = (token: string) =>
  ['-A', '-B', '-C', '-g', '-m', '-t', '-T'].some(
    (option) => token.startsWith(option) && token.length > option.length,
  ) || /^--[^=]+=/.test(token);

const getRgPatternFromTokens = (tokens: string[]) => {
  if (tokens[0] !== 'rg') return;

  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    const attachedPattern = getAttachedRgPattern(token);
    if (attachedPattern) return attachedPattern;

    if (RG_PATTERN_OPTIONS.has(token)) {
      return tokens[index + 1];
    }

    if (token === '--') {
      return tokens[index + 1];
    }

    if (RG_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      if (isRgOptionWithAttachedValue(token)) continue;
      continue;
    }

    return token;
  }
};

export interface CodexGrepCommandDisplay {
  pattern: string;
}

export const getCodexGrepCommandDisplay = (
  command?: string,
): CodexGrepCommandDisplay | undefined => {
  const displayCommand = stripShellWrapper(command);
  if (!displayCommand || hasUnsafeShellControlOperator(displayCommand)) return;

  const tokens = tokenizeShellLike(displayCommand);
  if (!tokens) return;
  if (!tokens.includes('|') && tokens.includes('--files')) return;

  const rgCommands = splitRgPipeline(tokens);
  if (!rgCommands) return;

  const pattern = getRgPatternFromTokens(rgCommands.at(-1) || []);
  if (!pattern) return;

  return { pattern };
};
