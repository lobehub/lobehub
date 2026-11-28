import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { resolveAgainstCwd } from '@lobechat/local-file-shell/file';
import { detectGitHubRepository, detectRepoType } from '@lobechat/local-file-shell/git';
import { isTrimmedNonEmptyString } from '@lobechat/utils/object';
import matter from 'gray-matter';

import type {
  BrowseDirectoryParams,
  BrowseDirectoryResult,
  DiscoverAgentFilesParams,
  DiscoverAgentFilesResult,
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

/** The nearest ancestor of `dir` (or `dir` itself) holding `.git`, else `dir`. */
const resolveRepositoryRoot = async (dir: string): Promise<string> => {
  const dirs = await resolveAgentFileDirs(dir);
  return dirs.at(-1) ?? dir;
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

interface SkillFrontmatterFields {
  description?: string;
  disableModelInvocation?: boolean;
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
      disableModelInvocation: data['disable-model-invocation'] === true,
      name: readStringField(data, 'name'),
    };
  } catch {
    return {};
  }
};

type SkillCandidate = ProjectSkillItem & { realPath: string };

/**
 * Scan one skill source directory and return parsed frontmatter for each
 * `SKILL.md`. Once a directory contains `SKILL.md`, treat it as a skill root
 * and do not recurse into its subdirectories (`scripts/`, `references/`, etc.).
 * Returns `[]` when the source directory is absent or unreadable.
 * Candidates are ordered by directory name to make alias precedence stable;
 * at most `limit` of them are read.
 */
const scanSkillsInSource = async (
  { previewRoot, scope, source, sourceRoot }: SkillScanRoot,
  seenRealPaths: ReadonlySet<string>,
  limit = Infinity,
): Promise<(SkillCandidate | null)[]> => {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return Promise.all(
    entries
      .filter(
        (entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(async (entry): Promise<SkillCandidate | null> => {
        const skillDir = path.join(sourceRoot, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        try {
          const realPath = await realpath(skillFile);
          if (seenRealPaths.has(realPath)) return null;

          const raw = await readFile(skillFile, 'utf8');
          const fields = parseSkillFrontmatter(raw);
          return {
            description: fields.description || undefined,
            disableModelInvocation: fields.disableModelInvocation,
            name: fields.name || entry.name,
            path: skillFile,
            previewRoot,
            realPath,
            scope,
            skillDir,
            source,
          };
        } catch {
          return null;
        }
      }),
  );
};

/** Skills under `roots`, earlier roots winning on a name; `limit` caps the `SKILL.md` reads. */
const collectSkills = async (
  roots: SkillScanRoot[],
  limit = Infinity,
): Promise<ProjectSkillItem[]> => {
  const seenNames = new Set<string>();
  const seenRealPaths = new Set<string>();
  const skills: ProjectSkillItem[] = [];
  let remaining = limit;

  for (const root of roots) {
    if (remaining <= 0) break;
    const candidates = await scanSkillsInSource(root, seenRealPaths, remaining);
    remaining -= candidates.length;
    for (const skill of candidates) {
      if (!skill || seenNames.has(skill.name) || seenRealPaths.has(skill.realPath)) continue;
      const { realPath, ...item } = skill;
      seenNames.add(item.name);
      seenRealPaths.add(realPath);
      skills.push(item);
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
/** Project cap; device instructions have a separate single-file budget. */
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

/** Read at most one device instruction file, preferring AGENTS.md over CLAUDE.md. */
const readDeviceInstructions = async (): Promise<WorkspaceInstructionsItem[]> => {
  const home = os.homedir();

  for (const [directory, source] of [
    ['.agents', 'AGENTS.md'],
    ['.claude', 'CLAUDE.md'],
  ] as const) {
    const filePath = path.join(home, directory, source);
    try {
      const raw = await readFile(filePath, 'utf8');
      if (!isTrimmedNonEmptyString(raw)) continue;

      const { content } = truncateUtf8(raw, MAX_INSTRUCTIONS_FILE_BYTES);
      return [{ content, path: filePath, scope: 'device', source }];
    } catch {
      // File absent or unreadable; try the next global location.
    }
  }

  return [];
};

/**
 * Read the agent instructions files (`AGENTS.md`, then `CLAUDE.md`) in `dirs`
 * (nearest first), returned root first so the most specific file comes last
 * in the prompt, as the other harnesses order them.
 *
 * Both names are read in each directory since they can coexist, except when
 * one is a symlink to the other (a common way to share one file between
 * harnesses): each real file is read once within the project scan. The budget is
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
 * (deduped by name, project winning) and load the device's global instructions.
 * A bound working directory also contributes project instructions, root first.
 * Without one, neither the daemon's cwd nor the home directory is an implicit project.
 * Approves the selected project root and discovered skill preview roots.
 */
export const initWorkspace = async (
  params: InitWorkspaceParams,
  deps: WorkspaceScanDeps = {},
): Promise<InitWorkspaceResult> => {
  const root = params.scope;

  const dirs = root ? await resolveAgentFileDirs(root) : [];
  const skills = await collectSkills([
    ...(root ? createProjectSkillRoots(root, dirs) : []),
    ...createDeviceSkillRoots(),
  ]);
  const instructions = [
    ...(await readDeviceInstructions()),
    ...(await readWorkspaceInstructions(dirs)),
  ];

  await approvePreviewRoots(skills, deps, root ? [root] : []);

  return { instructions, root, skills };
};

/**
 * Upper bound on `SKILL.md` files one discovery reads. Each is read whole to
 * parse its frontmatter, so a directory holding hundreds of skills must not
 * turn the file tool it rides on into a bulk read.
 */
const MAX_DISCOVERED_SKILLS = 150;

/**
 * Time a discovery may add to the file tool it rides on. Past it the tool
 * result goes out without agent files and the directory stays unscanned, so a
 * later call there tries again.
 */
const DISCOVERY_TIME_BUDGET_MS = 2000;

/** `target` is `root` or below it. A child named `..cache` is still below it. */
const isWithin = (root: string, target: string) => {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

/**
 * The directory a tool call touches: `target` itself when it is a directory,
 * otherwise its parent (also for a file `writeFile` is about to create).
 */
const resolveTouchedDir = async (target: string): Promise<string> => {
  try {
    if ((await stat(target)).isDirectory()) return target;
  } catch {
    // Not created yet; its parent is still the directory being entered.
  }
  return path.dirname(target);
};

/** `dir` with symlinks resolved, or its nearest existing parent's real path joined back. */
const realDir = async (dir: string): Promise<string> => {
  try {
    return await realpath(dir);
  } catch {
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    return path.join(await realDir(parent), path.basename(dir));
  }
};

/**
 * Directories a file tool call newly brings into scope, nearest first: the
 * touched directory, then each parent up to the working directory, stopping
 * before one the run already has (`known`).
 */
const resolveDiscoveryDirs = (start: string, root: string, known: ReadonlySet<string>) => {
  const dirs: string[] = [];
  let current = start;

  // `isWithin` as well as `current === root`: it compares the way the
  // platform does (case-insensitively on Windows), so the walk stops at the
  // working directory even when a spelling differs from `root`.
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && isWithin(root, current); depth += 1) {
    if (known.has(current)) break;
    dirs.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
};

const scan = async (
  params: DiscoverAgentFilesParams,
): Promise<Omit<DiscoverAgentFilesResult, 'durationMs'>> => {
  const target = resolveAgainstCwd(params.path, params.cwd);
  if (!target) return { dirs: [], instructions: [], outcome: 'unresolved', skills: [] };

  // Compared on real paths, so a symlink inside the working directory is
  // treated as the tree it points into.
  const workingRoot = await realDir(path.resolve(params.root));
  const start = await realDir(await resolveTouchedDir(path.resolve(target)));
  // Outside the working directory the walk stops at the target's own
  // repository root, as the start-of-run scan does for the working
  // directory. The tool call already ran, so the user allowed reading there
  // (an approval, or auto-approve); that tree's rules are what the model
  // should follow while it works in it.
  const root = isWithin(workingRoot, start) ? workingRoot : await resolveRepositoryRoot(start);

  const known = new Set(
    await Promise.all((params.knownDirs ?? []).map((dir) => realDir(path.resolve(dir)))),
  );
  const dirs = resolveDiscoveryDirs(start, root, known);
  if (dirs.length === 0) return { dirs, instructions: [], outcome: 'empty', skills: [] };

  const roots = dirs.flatMap((dir) =>
    SKILL_SOURCES.map((source) => {
      const sourceRoot = path.join(dir, source);
      return { previewRoot: sourceRoot, scope: 'project' as const, source, sourceRoot };
    }),
  );
  const [instructions, skills] = await Promise.all([
    readWorkspaceInstructions(dirs),
    collectSkills(roots, MAX_DISCOVERED_SKILLS),
  ]);

  return {
    dirs,
    instructions,
    outcome: instructions.length > 0 || skills.length > 0 ? 'found' : 'empty',
    skills,
  };
};

/**
 * Mid-run counterpart of {@link initWorkspace}: when a file tool or command
 * reads, writes or enters a directory the run has not scanned (a package of a
 * monorepo, or another repository on the device), find the agent files that
 * apply there. Like Claude Code, which loads a subdirectory's `CLAUDE.md` and
 * skills the first time the model touches a file in it. Below the working
 * directory the walk stops at it; elsewhere it stops at the target's
 * repository root, since the call that ran there was already allowed.
 *
 * Runs inside the file tool call it rides on (see `LocalSystemExecutionRuntime`),
 * so it needs no authorization or wake handling of its own.
 *
 * Only project skills are returned — device skills came with the run's start.
 * No preview root is approved: these skills are loaded through the run's file
 * tools, and approving a root here would widen what the web preview can read
 * on the strength of one tool call.
 */
/**
 * Scans still running, by what they scan. The time budget only stops waiting:
 * a scan on a slow disk keeps going, so a later call for the same directory
 * joins it instead of starting another one beside it.
 */
const inflightScans = new Map<string, ReturnType<typeof scan>>();

const scanOnce = (params: DiscoverAgentFilesParams) => {
  const target = resolveAgainstCwd(params.path, params.cwd);
  const key = JSON.stringify([
    params.root,
    target ? path.dirname(path.resolve(target)) : params.path,
    params.knownDirs ?? [],
  ]);
  const running = inflightScans.get(key);
  if (running) return running;

  const started = scan(params).finally(() => inflightScans.delete(key));
  inflightScans.set(key, started);
  return started;
};

export const discoverAgentFiles = async (
  params: DiscoverAgentFilesParams,
): Promise<DiscoverAgentFilesResult> => {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Omit<DiscoverAgentFilesResult, 'durationMs'>>((resolve) => {
    timer = setTimeout(
      () => resolve({ dirs: [], instructions: [], outcome: 'timed-out', skills: [] }),
      DISCOVERY_TIME_BUDGET_MS,
    );
  });

  try {
    const result = await Promise.race([
      scanOnce(params).catch(() => ({
        dirs: [],
        instructions: [],
        outcome: 'failed' as const,
        skills: [],
      })),
      timedOut,
    ]);
    return { ...result, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
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
