import { describeShellCommandTitle } from './shellCommand/describeShellCommandTitle';
import { readableShellCommand } from './shellCommand/readableShellCommand';
import type { ShellCommandTitle } from './shellCommand/types';

// Arg keys checked in priority order. NAME_KEYS (model-written description /
// title) lead because they state what the step does; then query/pattern
// outranks path (Grep/Glob-style calls carry both, and the pattern is the
// informative half); pure file tools (Read/Edit/Write) only carry a path.
const NAME_KEYS = ['name', 'title', 'skill', 'description', 'prompt'];
const COMMAND_KEYS = ['command', 'cmd', 'script'];
const QUERY_KEYS = ['query', 'q', 'pattern', 'keywords'];
const PATH_KEYS = ['file_path', 'filePath', 'path', 'filename', 'file'];
const URL_KEYS = ['url', 'urls'];

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

const extractUrlKeyword = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * Distill tool-call args down to the most informative text so the collapsed
 * inspector row can read as "<action> <keyword>" instead of dumping raw
 * arguments. Returns undefined when nothing identifiable is present. Long
 * results are truncated by CSS ellipsis at the render site.
 */
export const extractToolKeyword = (args?: Record<string, unknown>): string | undefined => {
  if (!args) return undefined;

  // The model-written description ("恢复登录态", "List files in current
  // directory") is the clearest statement of what this step does — every
  // command-running tool schema asks for one, so prefer it over the raw command.
  const description = pickString(args, NAME_KEYS);
  if (description) return description;

  // Without a description, show the command itself as one readable line
  // (setup, heredoc bodies and output plumbing dropped). Picking a single
  // token produced titles like `<<'EOF'`, `cat` or `for` that named nothing.
  const command = pickString(args, COMMAND_KEYS);
  if (command) return readableShellCommand(command);

  const query = pickString(args, QUERY_KEYS);
  if (query) return query;

  const path = pickString(args, PATH_KEYS);
  if (path) return basename(path);

  const url = pickString(args, URL_KEYS);
  if (url) return extractUrlKeyword(url);

  return undefined;
};

/**
 * What an undescribed shell command does ("读取 app.ts", "运行测试 a.test.ts"),
 * to replace the generic "执行命令 <command line>" title. `undefined` when the
 * call has a model-written description (which already says what it does) or
 * when no action describes the command.
 */
export const getShellCommandTitle = (
  args?: Record<string, unknown>,
): ShellCommandTitle | undefined => {
  if (!args || pickString(args, NAME_KEYS)) return undefined;
  // `script` is left out: it can hold source code for a non-shell runtime.
  const command = pickString(args, ['command', 'cmd']);
  return command ? describeShellCommandTitle(command) : undefined;
};
