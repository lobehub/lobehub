import type { Dirent } from 'node:fs';
import { opendir, readdir, readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { expandTilde } from '@lobechat/local-file-shell/file';
import { detectRepoType } from '@lobechat/local-file-shell/git';
import matter from 'gray-matter';

import type {
  DevicePathStyle,
  InitWorkspaceParams,
  InitWorkspaceResult,
  ListDirEntry,
  ListDirErrorCode,
  ListDirResult,
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
// The folder picker supports direct path entry, so bound discovery work instead
// of enumerating arbitrarily large directories across the device gateway.
const MAX_LIST_DIR_ENTRIES = 100;
const MAX_LIST_DIR_SCANNED_ENTRIES = 1000;

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

const getDevicePathStyle = (): DevicePathStyle =>
  process.platform === 'win32' ? 'windows' : 'posix';

const resolveDevicePath = (raw?: string): string => {
  const home = os.homedir();
  const trimmed = raw?.trim();
  if (!trimmed) return home;

  const expanded = expandTilde(trimmed) ?? trimmed;
  return path.normalize(path.isAbsolute(expanded) ? expanded : path.resolve(home, expanded));
};

const getPathRoots = (resolvedPath: string): string[] => {
  const root = path.parse(resolvedPath).root;
  return root ? [root] : [];
};

const getListDirErrorCode = (error: unknown): ListDirErrorCode => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'NOT_FOUND';
  if (code === 'ENOTDIR') return 'NOT_DIRECTORY';
  if (code === 'EACCES' || code === 'EPERM') return 'PERMISSION_DENIED';
  return 'UNKNOWN';
};

const createListDirError = (path: string, code: ListDirErrorCode): ListDirResult => ({
  code,
  home: os.homedir(),
  path,
  pathStyle: getDevicePathStyle(),
  roots: getPathRoots(path),
  success: false,
});

const resolveListDirDirectory = async (
  parent: string,
  entry: Dirent,
): Promise<ListDirEntry | null> => {
  const entryPath = path.join(parent, entry.name);
  const base = {
    hidden: entry.name.startsWith('.'),
    isSymlink: entry.isSymbolicLink(),
    name: entry.name,
    path: entryPath,
  };

  if (entry.isDirectory()) return { ...base, type: 'directory' };
  if (!entry.isSymbolicLink()) return null;

  try {
    const target = await stat(entryPath);
    if (target.isDirectory()) return { ...base, type: 'directory' };
  } catch {
    // Broken or inaccessible symlinks are not navigable and reveal no useful
    // folder-picker target, so leave them out of the listing.
  }
  return null;
};

/**
 * List one device-local directory for the remote folder picker. The device owns
 * all path expansion and classification so a POSIX web server never has to
 * parse a Windows path (or vice versa). Only directories are returned because
 * files are not valid picker targets. Both the scan and result are capped so a
 * large directory cannot create unbounded device work or gateway payloads.
 */
export const listDir = async (params: { path?: string } = {}): Promise<ListDirResult> => {
  const resolved = resolveDevicePath(params.path);

  let stats;
  try {
    stats = await stat(resolved);
  } catch (error) {
    return createListDirError(resolved, getListDirErrorCode(error));
  }
  if (!stats.isDirectory()) return createListDirError(resolved, 'NOT_DIRECTORY');

  let directory;
  try {
    directory = await opendir(resolved);
  } catch (error) {
    return createListDirError(resolved, getListDirErrorCode(error));
  }

  const entries: ListDirEntry[] = [];
  let scannedEntries = 0;
  try {
    for await (const entry of directory) {
      if (scannedEntries >= MAX_LIST_DIR_SCANNED_ENTRIES) break;
      scannedEntries += 1;

      const resolvedEntry = await resolveListDirDirectory(resolved, entry);
      if (resolvedEntry) entries.push(resolvedEntry);
      if (entries.length > MAX_LIST_DIR_ENTRIES) break;
    }
  } catch (error) {
    return createListDirError(resolved, getListDirErrorCode(error));
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > MAX_LIST_DIR_ENTRIES) entries.length = MAX_LIST_DIR_ENTRIES;
  const parent = path.dirname(resolved);

  return {
    entries,
    home: os.homedir(),
    parent: parent === resolved ? null : parent,
    path: resolved,
    pathStyle: getDevicePathStyle(),
    roots: getPathRoots(resolved),
    success: true,
  };
};

/**
 * Check whether a path exists on this device and is a directory, plus its git
 * repo type. Used to validate a manually-entered working directory from a web /
 * remote client before binding it, and to render the right dir icon.
 */
export const statPath = async (params: { path: string }): Promise<StatPathResult> => {
  const resolved = resolveDevicePath(params.path);
  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return { exists: true, isDirectory: false, path: resolved };
    const repoType = await detectRepoType(resolved);
    return { exists: true, isDirectory: true, path: resolved, repoType };
  } catch {
    return { exists: false, isDirectory: false, path: resolved };
  }
};
