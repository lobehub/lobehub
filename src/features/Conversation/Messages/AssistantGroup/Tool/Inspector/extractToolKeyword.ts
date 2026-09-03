const MAX_KEYWORD_LENGTH = 32;

// Arg keys checked in priority order. Query/pattern outranks path because
// Grep/Glob-style calls carry both, and the pattern is the informative half;
// pure file tools (Read/Edit/Write) only carry a path.
const COMMAND_KEYS = ['command', 'cmd', 'script'];
const QUERY_KEYS = ['query', 'q', 'pattern', 'keywords'];
const PATH_KEYS = ['file_path', 'filePath', 'path', 'filename', 'file'];
const URL_KEYS = ['url', 'urls'];
const NAME_KEYS = ['name', 'title', 'skill', 'description', 'prompt'];

// Shell tokens that never identify the program being run. The ones that take
// an argument (`source .env`, `cd dir`) consume the following token too.
const SHELL_NOISE = new Set(['env', 'exec', 'nice', 'nohup', 'set', 'sudo', 'time']);
const SHELL_NOISE_WITH_ARG = new Set(['.', 'cd', 'source']);
// Launchers whose next token (or a later path) is the real subject.
const SHELL_RUNNERS = new Set([
  'bash',
  'bun',
  'bunx',
  'deno',
  'node',
  'npm',
  'npx',
  'pnpm',
  'python',
  'python3',
  'run',
  'sh',
  'ts-node',
  'tsx',
  'uv',
  'uvx',
  'yarn',
  'zsh',
]);

const truncate = (value: string, maxLength = MAX_KEYWORD_LENGTH): string =>
  value.length > maxLength ? value.slice(0, maxLength) + '…' : value;

const basename = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).pop() || trimmed;
};

const pickString = (args: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    // e.g. web-browsing `urls: string[]`
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim())
      return value[0].trim();
  }
  return undefined;
};

/**
 * Pull the program (or script file) actually being run out of a shell command,
 * skipping env assignments, flags, and wrapper launchers:
 * `set -a && source .env && npx tsx scripts/report/monthly.ts` → `monthly.ts`.
 */
const extractCommandKeyword = (command: string): string | undefined => {
  const tokens = command.split(/[\s;&|()]+/).filter(Boolean);

  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (/^[A-Z_]\w*=/i.test(token)) continue; // env assignment
    if (/^[+-]/.test(token)) continue; // flag
    if (SHELL_NOISE_WITH_ARG.has(token)) {
      skipNext = true;
      continue;
    }
    if (SHELL_NOISE.has(token)) continue;
    if (SHELL_RUNNERS.has(token)) continue;

    return token.includes('/') ? basename(token) : token;
  }

  return tokens[0];
};

const extractUrlKeyword = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * Distill tool-call args down to the single most informative token so the
 * collapsed inspector row can read as "<action> <keyword>" instead of dumping
 * raw arguments. Returns undefined when nothing identifiable is present.
 */
export const extractToolKeyword = (args?: Record<string, unknown>): string | undefined => {
  if (!args) return undefined;

  const command = pickString(args, COMMAND_KEYS);
  if (command) {
    const keyword = extractCommandKeyword(command);
    if (keyword) return truncate(keyword);
  }

  const query = pickString(args, QUERY_KEYS);
  if (query) return truncate(query);

  const path = pickString(args, PATH_KEYS);
  if (path) return truncate(basename(path));

  const url = pickString(args, URL_KEYS);
  if (url) return truncate(extractUrlKeyword(url));

  const name = pickString(args, NAME_KEYS);
  if (name) return truncate(name);

  return undefined;
};
