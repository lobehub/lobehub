import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import type {
  ClaudeCodeMemoryFile,
  ClaudeCodeMemoryRunEnv,
  ListClaudeCodeMemoryParams,
  ListClaudeCodeMemoryResult,
  WorkspaceScanDeps,
} from './types';

const MEMORY_INDEX_FILE = 'MEMORY.md';
const MAX_MEMORY_FILES = 500;
// Claude Code caps the sanitized project key and appends a hash beyond this.
const MAX_PROJECT_KEY_LENGTH = 200;
// The `CLAUDE_CODE_PROJECT_DIR_NAME` values Claude Code accepts; it derives the key for any other.
const PROJECT_DIR_NAME = /^[\w-]{1,64}$/;
const WINDOWS_DEVICE_NAME = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])$/i;
const RUN_ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PROJECT_DIR_NAME'] as const;

interface ClaudeCodeMemoryEnv {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  /** System directory of the file-based managed settings; the platform's own by default. */
  managedSettingsDir?: string;
}

const defaultManagedSettingsDir = () => {
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (process.platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
};

/** Java-style 32-bit string hash, the one Claude Code suffixes long keys with. */
const hashString = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
};

/**
 * Claude Code's project key: the NFC-normalized root with every non-alphanumeric
 * character replaced by `-`. macOS can hand back decomposed accents; the CLI
 * keys the composed form. Mirrors heterogeneous-agents' `encodeClaudeProjectDir`,
 * kept here so the device RPC does not load the transcript parsers.
 */
export const toClaudeCodeProjectKey = (projectRoot: string): string => {
  const normalized = projectRoot.normalize('NFC');
  const key = normalized.replaceAll(/[^a-z0-9]/gi, '-');
  if (key.length <= MAX_PROJECT_KEY_LENGTH) return key;
  return `${key.slice(0, MAX_PROJECT_KEY_LENGTH)}-${hashString(normalized)}`;
};

const isFile = async (target: string) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const isDirectory = async (target: string) => {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The root Claude Code keys memory by: the main checkout of the enclosing git
 * repository, so every worktree and subdirectory of one repo shares a single
 * memory directory. Outside git it is the directory itself.
 */
export const resolveClaudeCodeProjectRoot = async (cwd: string): Promise<string> => {
  const start = await realpath(cwd).catch(() => path.resolve(cwd));

  for (let dir = start; ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, '.git');
    if (await isDirectory(dotGit)) return dir;

    if (await isFile(dotGit)) {
      // A linked worktree: `.git` points at `<main>/.git/worktrees/<name>`,
      // whose `commondir` leads back to the main repository's `.git`.
      try {
        const pointer = (await readFile(dotGit, 'utf8'))
          .split('\n')
          .find((line) => line.startsWith('gitdir:'))
          ?.slice('gitdir:'.length)
          .trim();
        if (!pointer) return dir;
        const gitDir = path.resolve(dir, pointer);
        const commonDir = (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim();
        const mainGitDir = await realpath(path.resolve(gitDir, commonDir));
        return path.basename(mainGitDir) === '.git' ? path.dirname(mainGitDir) : dir;
      } catch {
        // No `commondir` (a submodule) or an unreadable pointer: the checkout is its own root.
        return dir;
      }
    }

    if (path.dirname(dir) === dir) return start;
  }
};

const readJsonObject = async (file: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** An `autoMemoryDirectory` value counts only as an absolute path or one under `~/`. */
const toMemoryDirectory = (value: unknown, homedir: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(homedir, trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : undefined;
};

/** `managed-settings.json`, then the `managed-settings.d/*.json` drop-ins alphabetically. */
const listManagedSettingsFiles = async (dir: string): Promise<string[]> => {
  const dropInDir = path.join(dir, 'managed-settings.d');
  const dropIns = await readdir(dropInDir).catch((): string[] => []);
  return [
    path.join(dir, 'managed-settings.json'),
    ...dropIns
      .filter((name) => !name.startsWith('.') && name.endsWith('.json'))
      .sort()
      .map((name) => path.join(dropInDir, name)),
  ];
};

/**
 * `autoMemoryDirectory` from the settings scope Claude Code lets win: the
 * file-based managed settings (a later drop-in over an earlier one), then
 * project local, shared project and user settings. Local settings sit at the
 * repository root (the main checkout for a worktree), with a file an older CLI
 * left in the working directory as the fallback; shared project settings sit in
 * the working directory. MDM and server-managed policy and `--settings` are not
 * on disk here.
 */
const readMemoryDirectoryOverride = async ({
  configDir,
  cwd,
  homedir,
  managedSettingsDir,
  projectRoot,
}: {
  configDir: string;
  cwd: string;
  homedir: string;
  managedSettingsDir: string;
  projectRoot: string;
}): Promise<string | undefined> => {
  const files = [
    ...(await listManagedSettingsFiles(managedSettingsDir)).reverse(),
    path.join(projectRoot, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(configDir, 'settings.json'),
  ];
  const settings = await Promise.all(files.map(readJsonObject));

  for (const scope of settings) {
    const directory = toMemoryDirectory(scope?.autoMemoryDirectory, homedir);
    if (directory) return directory;
  }
  return undefined;
};

/**
 * Where Claude Code keeps auto memory for `cwd`:
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project key>/memory`, where a
 * valid `CLAUDE_CODE_PROJECT_DIR_NAME` beside a `CLAUDE_CONFIG_DIR` replaces the
 * key, unless the settings point `autoMemoryDirectory` elsewhere.
 */
export const resolveClaudeCodeMemoryDir = async (
  cwd: string,
  {
    env = process.env,
    homedir = os.homedir(),
    managedSettingsDir = defaultManagedSettingsDir(),
  }: ClaudeCodeMemoryEnv = {},
): Promise<string> => {
  const workingDirectory = path.resolve(cwd);
  const customConfigDir = env.CLAUDE_CONFIG_DIR?.trim();
  // A relative config dir resolves the way the spawned CLI sees it: from its cwd.
  const configDir = customConfigDir
    ? path.resolve(workingDirectory, customConfigDir)
    : path.join(homedir, '.claude');
  const projectRoot = await resolveClaudeCodeProjectRoot(workingDirectory);

  const override = await readMemoryDirectoryOverride({
    configDir,
    cwd: workingDirectory,
    homedir,
    managedSettingsDir,
    projectRoot,
  });
  if (override) return override;

  const pinnedName = env.CLAUDE_CODE_PROJECT_DIR_NAME;
  const projectKey =
    customConfigDir &&
    pinnedName &&
    PROJECT_DIR_NAME.test(pinnedName) &&
    !WINDOWS_DEVICE_NAME.test(pinnedName)
      ? pinnedName
      : toClaudeCodeProjectKey(projectRoot);
  return path.join(configDir, 'projects', projectKey, 'memory');
};

/** The agent's non-blank values for the keys that move memory; the rest stay the device's. */
const pickRunEnv = (runEnv: ClaudeCodeMemoryRunEnv | undefined) =>
  Object.fromEntries(
    RUN_ENV_KEYS.flatMap((key) => {
      const value: unknown = runEnv?.[key];
      return typeof value === 'string' && value.trim() ? [[key, value]] : [];
    }),
  );

const readStringField = (data: Record<string, unknown> | undefined, key: string) => {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const parseMemoryFrontmatter = (raw: string) => {
  try {
    const { data } = matter(raw) as { data: Record<string, unknown> };
    const metadata =
      data.metadata && typeof data.metadata === 'object'
        ? (data.metadata as Record<string, unknown>)
        : undefined;
    return {
      description: readStringField(data, 'description'),
      name: readStringField(data, 'name'),
      type: readStringField(metadata, 'type') ?? readStringField(data, 'type'),
    };
  } catch {
    return {};
  }
};

const listMarkdownFiles = async (root: string): Promise<string[]> => {
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0 && results.length < MAX_MEMORY_FILES) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) results.push(fullPath);
      if (results.length >= MAX_MEMORY_FILES) break;
    }
  }

  return results;
};

const readMemoryFile = async (
  memoryDir: string,
  filePath: string,
): Promise<ClaudeCodeMemoryFile | null> => {
  try {
    const [raw, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
    const relativePath = path.relative(memoryDir, filePath).split(path.sep).join('/');
    const fields = parseMemoryFrontmatter(raw);
    return {
      description: fields.description,
      isIndex: relativePath === MEMORY_INDEX_FILE,
      name: fields.name ?? path.basename(filePath, path.extname(filePath)),
      path: filePath,
      relativePath,
      size: stats.size,
      type: fields.type,
      updatedAt: stats.mtimeMs,
    };
  } catch {
    return null;
  }
};

const containsPath = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * List Claude Code's auto-memory files for a project: the `MEMORY.md` index
 * first, then each memory with its frontmatter. An absent directory yields an
 * empty list. Approves the directory for the host preview protocol so the
 * files open (and save) from the workspace panel, unless it contains the
 * project itself: a repository setting pointing `autoMemoryDirectory` at `~`
 * or `/` must not open the whole tree.
 */
export const listClaudeCodeMemory = async (
  params: ListClaudeCodeMemoryParams,
  deps: WorkspaceScanDeps = {},
  { env = process.env, ...memoryEnv }: ClaudeCodeMemoryEnv = {},
): Promise<ListClaudeCodeMemoryResult> => {
  const memoryDir = await resolveClaudeCodeMemoryDir(params.scope, {
    ...memoryEnv,
    env: { ...env, ...pickRunEnv(params.env) },
  });
  if (!(await isDirectory(memoryDir))) return { files: [], memoryDir };

  const paths = await listMarkdownFiles(memoryDir);
  const files = (await Promise.all(paths.map((file) => readMemoryFile(memoryDir, file))))
    .filter((file): file is ClaudeCodeMemoryFile => file !== null)
    .sort((a, b) =>
      a.isIndex === b.isIndex ? a.relativePath.localeCompare(b.relativePath) : a.isIndex ? -1 : 1,
    );

  if (files.length > 0 && !containsPath(memoryDir, path.resolve(params.scope))) {
    await deps.approveProjectRoot?.(memoryDir);
  }

  return { files, memoryDir };
};
