import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { detectRepoType } from '@lobechat/local-file-shell';

import type {
  InitWorkspaceParams,
  InitWorkspaceResult,
  ListProjectSkillsParams,
  ListProjectSkillsResult,
  ProjectSkillItem,
  StatPathResult,
  WorkspaceInstructionsItem,
  WorkspaceScanDeps,
} from './types';

const SKILL_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Cap recursion to guard against pathological directory trees.
const MAX_SKILL_FILE_COUNT = 1000;

const SKILL_SOURCES = ['.agents/skills', '.claude/skills'] as const;

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

/**
 * Parse a minimal YAML frontmatter block for SKILL.md files. Only handles
 * `key: value` lines; multi-line block scalars fall back to the first line.
 */
const parseSkillFrontmatter = (raw: string): Record<string, string> => {
  const match = raw.match(SKILL_FRONTMATTER_RE);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key || key.startsWith('#')) continue;
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('|') || value.startsWith('>')) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
};

/**
 * Scan one skill source directory (e.g. `.agents/skills`) under `root` and
 * return parsed frontmatter for each `SKILL.md`. Returns `[]` when the source
 * directory is absent or unreadable. Unsorted — callers sort/merge.
 */
const scanSkillsInSource = async (
  root: string,
  source: ProjectSkillItem['source'],
): Promise<ProjectSkillItem[]> => {
  const dir = path.join(root, source);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry): Promise<ProjectSkillItem | null> => {
        const skillDir = path.join(dir, entry.name);
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
 * Scan agent skill directories under the project root. Returns the first source
 * directory that yields any skills (`.agents/skills` wins). Approves the root
 * for the host preview protocol when any skills are found.
 */
export const listProjectSkills = async (
  params: ListProjectSkillsParams,
  deps: WorkspaceScanDeps = {},
): Promise<ListProjectSkillsResult> => {
  const root = params.scope;

  for (const source of SKILL_SOURCES) {
    const skills = (await scanSkillsInSource(root, source)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    if (skills.length > 0) {
      await deps.approveProjectRoot?.(root);
      return { root, skills, source };
    }
  }

  return { root, skills: [], source: null };
};

/**
 * One-call "workspace init" scan: merge project skills from BOTH
 * `.agents/skills` and `.claude/skills` (deduped by name, `.agents/skills`
 * winning) and read the project-root agent instructions. Approves the root for
 * the host preview protocol regardless of what was found, since the run is now
 * bound to this root.
 */
export const initWorkspace = async (
  params: InitWorkspaceParams,
  deps: WorkspaceScanDeps = {},
): Promise<InitWorkspaceResult> => {
  const root = params.scope;

  const seen = new Set<string>();
  const skills: ProjectSkillItem[] = [];
  for (const source of SKILL_SOURCES) {
    for (const skill of await scanSkillsInSource(root, source)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const instructions = await readWorkspaceInstructions(root);

  await deps.approveProjectRoot?.(root);

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
