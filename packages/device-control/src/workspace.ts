import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { detectGitHubRepository, detectRepoType } from '@lobechat/local-file-shell/git';
import matter from 'gray-matter';

import type {
  BrowseDirectoryParams,
  BrowseDirectoryResult,
  InitWorkspaceParams,
  InitWorkspaceResult,
  ListProjectSkillsParams,
  ListProjectSkillsResult,
  ProjectSkillItem,
  ProjectSkillScope,
  ProjectSkillSource,
  StatPathResult,
  WorkspaceInstructionsItem,
  WorkspaceScanDeps,
} from './types';

// Cap recursion to guard against pathological directory trees.
const MAX_SKILL_FILE_COUNT = 1000;
const DEFAULT_DIRECTORY_PAGE_SIZE = 200;
const MAX_DIRECTORY_PAGE_SIZE = 1000;

const SKILL_SOURCES = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
] as const satisfies readonly ProjectSkillSource[];

/**
 * Upper bound on directories walked from the working directory to the
 * repository root, so a pathological path cannot turn one scan into hundreds
 * of filesystem probes.
 */
const MAX_ANCESTOR_DEPTH = 32;

interface SkillScanRoot {
  previewRoot: string;
  scope: ProjectSkillScope;
  source: ProjectSkillSource;
  sourceRoot: string;
}

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Directories whose agent files apply to `root`, nearest first: `root` itself,
 * then each parent up to and including the repository root (the nearest
 * ancestor containing `.git`, a directory in a checkout and a file in a
 * worktree or submodule). Without a repository root only `root` applies, so a
 * directory outside any repository never picks up files from `~` or `/`.
 *
 * Mirrors the startup discovery of Codex, Claude Code, OpenCode and pi, so a
 * run bound to `packages/web` of a monorepo still sees the root `AGENTS.md`
 * and `.agents/skills`.
 */
const resolveAgentFileDirs = async (root: string): Promise<string[]> => {
  const start = path.resolve(root);
  const dirs: string[] = [];
  let current = start;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    dirs.push(current);
    if (await pathExists(path.join(current, '.git'))) return dirs;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return [start];
};

const createProjectSkillRoots = (root: string, dirs: string[]): SkillScanRoot[] =>
  dirs.flatMap((dir, index) =>
    SKILL_SOURCES.map((source) => {
      const sourceRoot = path.join(dir, source);
      return {
        // Skills in the working directory preview against it, as before. A
        // parent directory is not an approved root, so its skills preview
        // against their own source directory, the way device skills do.
        previewRoot: index === 0 ? root : sourceRoot,
        scope: 'project' as const,
        source,
        sourceRoot,
      };
    }),
  );

const createDeviceSkillRoots = (): SkillScanRoot[] => {
  const home = os.homedir();

  return SKILL_SOURCES.map((source) => {
    const sourceRoot = path.join(home, source);
    return {
      previewRoot: sourceRoot,
      scope: 'device',
      source,
      sourceRoot,
    };
  });
};

/**
 * Scan order decides name collisions (first wins): the working directory
 * before its parents, project before device.
 */
const createSkillRoots = async (root: string): Promise<SkillScanRoot[]> => [
  ...createProjectSkillRoots(root, await resolveAgentFileDirs(root)),
  ...createDeviceSkillRoots(),
];

const toPosixRelativePath = (filePath: string) => filePath.split(path.sep).join('/');

const listSkillFilesRecursive = async (dir: string): Promise<string[]> => {
  const results: string[] = [];
  const stack: string[] = [dir];

  while (stack.length > 0 && results.length < MAX_SKILL_FILE_COUNT) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(toPosixRelativePath(path.relative(dir, full)));
        if (results.length >= MAX_SKILL_FILE_COUNT) break;
      }
    }
  }
  return results.sort();
};

interface SkillFrontmatterFields {
  description?: string;
  name?: string;
}

const readStringField = (data: Record<string, unknown>, field: keyof SkillFrontmatterFields) => {
  const value = data[field];
  return typeof value === 'string' ? value.trim() : undefined;
};

/**
 * Parse SKILL.md YAML frontmatter. `gray-matter` handles block scalars such as
 * `description: >`, keeping this path aligned with the server-side skill parser.
 */
const parseSkillFrontmatter = (raw: string): SkillFrontmatterFields => {
  try {
    const { data } = matter(raw) as { data: Record<string, unknown> };
    return {
      description: readStringField(data, 'description'),
      name: readStringField(data, 'name'),
    };
  } catch {
    return {};
  }
};

/**
 * Scan one skill source directory and return parsed frontmatter for each
 * `SKILL.md`. Returns `[]` when the source directory is absent or unreadable.
 * Unsorted — callers sort/merge.
 */
const scanSkillsInSource = async ({
  previewRoot,
  scope,
  source,
  sourceRoot,
}: SkillScanRoot): Promise<ProjectSkillItem[]> => {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry): Promise<ProjectSkillItem | null> => {
        const skillDir = path.join(sourceRoot, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        try {
          const raw = await readFile(skillFile, 'utf8');
          const fields = parseSkillFrontmatter(raw);
          const files = await listSkillFilesRecursive(skillDir);
          return {
            description: fields.description || undefined,
            fileCount: files.length,
            files,
            name: fields.name || entry.name,
            path: skillFile,
            previewRoot,
            scope,
            skillDir,
            source,
          };
        } catch {
          return null;
        }
      }),
  );

  return skills.filter((skill): skill is ProjectSkillItem => skill !== null);
};

const collectSkills = async (roots: SkillScanRoot[]): Promise<ProjectSkillItem[]> => {
  const seen = new Set<string>();
  const skills: ProjectSkillItem[] = [];

  for (const root of roots) {
    for (const skill of await scanSkillsInSource(root)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
};

const approvePreviewRoots = async (
  skills: ProjectSkillItem[],
  deps: WorkspaceScanDeps,
  extraRoots: string[] = [],
): Promise<void> => {
  if (!deps.approveProjectRoot) return;

  const roots = new Set([...extraRoots, ...skills.map((skill) => skill.previewRoot)]);
  await Promise.all([...roots].map((root) => deps.approveProjectRoot!(root)));
};

/** Per-file cap, so one oversized file cannot crowd out the others. */
const MAX_INSTRUCTIONS_FILE_BYTES = 64 * 1024;
/** Cap across every directory, bounding the cached payload and the system role. */
const MAX_INSTRUCTIONS_TOTAL_BYTES = 128 * 1024;
const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * Cut `raw` to at most `maxBytes` of UTF-8. Measuring `string.length` would
 * count UTF-16 units, letting CJK text exceed the budget about threefold. A
 * character split at the boundary decodes to U+FFFD and is dropped.
 */
const truncateUtf8 = (raw: string, maxBytes: number): { bytes: number; content: string } => {
  const buffer = Buffer.from(raw, 'utf8');
  if (buffer.length <= maxBytes) return { bytes: buffer.length, content: raw };

  const content = buffer
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD+$/, '');
  return { bytes: Buffer.byteLength(content, 'utf8'), content };
};

/**
 * Read the agent instructions files (`AGENTS.md`, then `CLAUDE.md`) in `dirs`
 * (nearest first), returned root first so the most specific file comes last
 * in the prompt, as the other harnesses order them.
 *
 * Both names are read in each directory since they can coexist, except when
 * one is a symlink to the other (a common way to share one file between
 * harnesses): the same file is never injected twice. The total budget is
 * spent nearest first, so when it runs out the farthest parents are dropped,
 * not the working directory's own rules.
 */
const readWorkspaceInstructions = async (dirs: string[]): Promise<WorkspaceInstructionsItem[]> => {
  const seen = new Set<string>();
  const byDir: WorkspaceInstructionsItem[][] = [];
  let remaining = MAX_INSTRUCTIONS_TOTAL_BYTES;

  for (const dir of dirs) {
    const found: WorkspaceInstructionsItem[] = [];
    for (const source of INSTRUCTION_FILENAMES) {
      if (remaining <= 0) break;
      const filePath = path.join(dir, source);
      try {
        const real = await realpath(filePath);
        if (seen.has(real)) continue;
        seen.add(real);

        const raw = await readFile(filePath, 'utf8');
        const { bytes, content } = truncateUtf8(
          raw,
          Math.min(MAX_INSTRUCTIONS_FILE_BYTES, remaining),
        );
        remaining -= bytes;
        found.push({ content, path: filePath, source });
      } catch {
        // File absent or unreadable; skip it.
      }
    }
    byDir.push(found);
  }

  return byDir.reverse().flat();
};

/**
 * Scan agent skill directories for the project (the working directory and its
 * parents up to the repository root) and the execution device. Nearer project
 * skills win over farther ones, and project skills over device skills, on name
 * collision. Approves each
 * discovered skill's preview root for the host preview protocol.
 */
export const listProjectSkills = async (
  params: ListProjectSkillsParams,
  deps: WorkspaceScanDeps = {},
): Promise<ListProjectSkillsResult> => {
  const root = params.scope;
  const skills = await collectSkills(await createSkillRoots(root));

  if (skills.length > 0) {
    await approvePreviewRoots(skills, deps);
  }

  return { root, skills, source: skills[0]?.source ?? null };
};

/**
 * One-call "workspace init" scan: merge project and execution-device skills
 * (deduped by name, project winning) and read the agent instructions from the
 * working directory up to the repository root. Approves the project root regardless of what was found, since
 * the run is now bound to this root.
 */
export const initWorkspace = async (
  params: InitWorkspaceParams,
  deps: WorkspaceScanDeps = {},
): Promise<InitWorkspaceResult> => {
  const root = params.scope;

  const dirs = await resolveAgentFileDirs(root);
  const skills = await collectSkills([
    ...createProjectSkillRoots(root, dirs),
    ...createDeviceSkillRoots(),
  ]);
  const instructions = await readWorkspaceInstructions(dirs);

  await approvePreviewRoots(skills, deps, [root]);

  return { instructions, root, skills };
};

/**
 * Check whether a path exists on this device and is a directory, plus its git
 * repo type. Used to validate a manually-entered working directory from a web /
 * remote client before binding it, and to render the right dir icon.
 */
export const statPath = async (params: { path: string }): Promise<StatPathResult> => {
  try {
    const stats = await stat(params.path);
    if (!stats.isDirectory()) return { exists: true, isDirectory: false };
    const repoType = await detectRepoType(params.path);
    const repositoryUrl = await detectGitHubRepository(params.path);
    return {
      canonicalPath: await realpath(params.path),
      exists: true,
      isDirectory: true,
      repoType,
      ...(repositoryUrl ? { repositoryUrl } : {}),
    };
  } catch {
    return { exists: false, isDirectory: false };
  }
};

const parseDirectoryCursor = (cursor?: string): number => {
  if (!cursor || !/^\d+$/.test(cursor)) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

const listFilesystemRoots = async (): Promise<string[]> => {
  if (os.platform() !== 'win32') return ['/'];

  const roots = await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const root = `${String.fromCharCode(65 + index)}:\\`;
      try {
        await access(root, constants.R_OK);
        return root;
      } catch {
        return undefined;
      }
    }),
  );

  return roots.filter((root): root is string => !!root);
};

/**
 * List one level of folders on the execution device for remote directory pickers.
 * Files are intentionally excluded so browsing does not expose project contents or
 * pay the cost of the recursive project-file index.
 */
export const browseDirectory = async (
  params: BrowseDirectoryParams = {},
): Promise<BrowseDirectoryResult> => {
  const homeDir = await realpath(os.homedir());
  const requestedPath = params.path?.trim() || homeDir;
  const directoryPath = await realpath(requestedPath);
  const directoryStat = await stat(directoryPath);
  if (!directoryStat.isDirectory()) throw new Error('Browse path is not a directory');

  const requestedLimit = params.limit ?? DEFAULT_DIRECTORY_PAGE_SIZE;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_DIRECTORY_PAGE_SIZE, Math.max(1, Math.trunc(requestedLimit)))
    : DEFAULT_DIRECTORY_PAGE_SIZE;
  const offset = parseDirectoryCursor(params.cursor);
  const dirents = await readdir(directoryPath, { withFileTypes: true });
  const candidateResults = await Promise.all(
    dirents.map(async (dirent) => {
      if (!dirent.name || dirent.name === '.' || dirent.name === '..') return undefined;
      if (dirent.name.startsWith('.')) return undefined;

      const entryPath = path.join(directoryPath, dirent.name);
      if (dirent.isDirectory()) {
        return { isSymlink: false, name: dirent.name, path: entryPath };
      }
      if (!dirent.isSymbolicLink()) return undefined;

      try {
        const canonicalPath = await realpath(entryPath);
        if (!(await stat(canonicalPath)).isDirectory()) return undefined;
        return { isSymlink: true, name: dirent.name, path: canonicalPath };
      } catch {
        // Broken links and entries that disappear during enumeration are omitted.
        return undefined;
      }
    }),
  );
  const candidates = candidateResults
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .sort((left, right) => left.name.localeCompare(right.name));
  const page = candidates.slice(offset, offset + limit);
  const entries = await Promise.all(
    page.map(async (entry) => {
      try {
        await access(entry.path, constants.R_OK | constants.X_OK);
        return { ...entry, readable: true };
      } catch {
        return { ...entry, readable: false };
      }
    }),
  );
  const nextOffset = offset + page.length;
  const parent = path.dirname(directoryPath);
  const truncated = nextOffset < candidates.length;

  return {
    entries,
    ...(truncated ? { nextCursor: String(nextOffset) } : {}),
    parentPath: parent === directoryPath ? null : parent,
    path: directoryPath,
    pathSeparator: path.sep === '\\' ? '\\' : '/',
    roots: await listFilesystemRoots(),
    truncated,
  };
};
