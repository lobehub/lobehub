import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { detectRepoType } from '@lobechat/local-file-shell/git';
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
] as const satisfies readonly ProjectSkillSource[];

interface SkillScanRoot {
  previewRoot: string;
  scope: ProjectSkillScope;
  source: ProjectSkillSource;
  sourceRoot: string;
}

const createProjectSkillRoots = (root: string): SkillScanRoot[] =>
  SKILL_SOURCES.map((source) => ({
    previewRoot: root,
    scope: 'project',
    source,
    sourceRoot: path.join(root, source),
  }));

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

const createSkillRoots = (root: string): SkillScanRoot[] => [
  ...createProjectSkillRoots(root),
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

/**
 * Read the project-root agent instructions files (`AGENTS.md`, then `CLAUDE.md`).
 * Collects every present candidate rather than first-match, since both can
 * coexist. Each body is capped so a pathologically large file can't bloat the
 * cached payload or the injected system role.
 */
const readWorkspaceInstructions = async (root: string): Promise<WorkspaceInstructionsItem[]> => {
  const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
  const candidates = ['AGENTS.md', 'CLAUDE.md'] as const;

  const instructions: WorkspaceInstructionsItem[] = [];
  for (const source of candidates) {
    try {
      const raw = await readFile(path.join(root, source), 'utf8');
      const content =
        raw.length > MAX_INSTRUCTIONS_BYTES ? raw.slice(0, MAX_INSTRUCTIONS_BYTES) : raw;
      instructions.push({ content, source });
    } catch {
      // File absent or unreadable; skip it.
    }
  }

  return instructions;
};

/**
 * Scan agent skill directories for the project and the execution device.
 * Project skills win over device skills on name collision. Approves each
 * discovered skill's preview root for the host preview protocol.
 */
export const listProjectSkills = async (
  params: ListProjectSkillsParams,
  deps: WorkspaceScanDeps = {},
): Promise<ListProjectSkillsResult> => {
  const root = params.scope;
  const skills = await collectSkills(createSkillRoots(root));

  if (skills.length > 0) {
    await approvePreviewRoots(skills, deps);
  }

  return { root, skills, source: skills[0]?.source ?? null };
};

/**
 * One-call "workspace init" scan: merge project and execution-device skills
 * (deduped by name, project winning) and read the project-root agent
 * instructions. Approves the project root regardless of what was found, since
 * the run is now bound to this root.
 */
export const initWorkspace = async (
  params: InitWorkspaceParams,
  deps: WorkspaceScanDeps = {},
): Promise<InitWorkspaceResult> => {
  const root = params.scope;

  const skills = await collectSkills(createSkillRoots(root));
  const instructions = await readWorkspaceInstructions(root);

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
    return { exists: true, isDirectory: true, repoType };
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
