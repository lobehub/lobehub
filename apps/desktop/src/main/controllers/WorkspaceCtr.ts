import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type InitWorkspaceParams,
  type InitWorkspaceResult,
  type ListProjectSkillsParams,
  type ListProjectSkillsResult,
  type ProjectSkillItem,
} from '@lobechat/electron-client-ipc';

import { detectRepoType } from '@/utils/git';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:WorkspaceCtr');

const SKILL_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Cap recursion to guard against pathological directory trees.
const MAX_SKILL_FILE_COUNT = 1000;

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

// Parse a minimal YAML frontmatter block for SKILL.md files.
// Only handles `key: value` lines; multi-line block scalars fall back to the first line.
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
 * WorkspaceCtr
 *
 * Owns "project workspace" scanning: discovering agent skills (`.agents/skills`
 * / `.claude/skills`) and project-root instructions (`AGENTS.md` / `CLAUDE.md`)
 * under a bound project directory. Split out of LocalFileCtr so the
 * workspace/agent-config concern is distinct from generic local file ops.
 */
export default class WorkspaceCtr extends ControllerModule {
  static override readonly groupName = 'workspace';

  /**
   * Scan one skill source directory (e.g. `.agents/skills`) under `root` and
   * return parsed frontmatter for each `SKILL.md`. Returns `[]` when the source
   * directory is absent or unreadable. Unsorted — callers sort/merge.
   */
  private async scanSkillsInSource(
    root: string,
    source: ProjectSkillItem['source'],
  ): Promise<ProjectSkillItem[]> {
    const dir = path.join(root, source);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Directory does not exist or is not readable.
      return [];
    }

    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map(async (entry) => {
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
  }

  /**
   * Scan agent skill directories under the project root and return parsed
   * frontmatter for each SKILL.md. Used by the hetero agent's working sidebar
   * to surface skills available in the current project. Returns the first
   * source directory that yields any skills (`.agents/skills` wins).
   */
  @IpcMethod()
  async listProjectSkills(params: ListProjectSkillsParams): Promise<ListProjectSkillsResult> {
    const root = params.scope;
    const sources = ['.agents/skills', '.claude/skills'] as const;

    for (const source of sources) {
      const skills = (await this.scanSkillsInSource(root, source)).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      if (skills.length > 0) {
        await this.approveProjectRootForPreview(root);
        return { root, skills, source };
      }
    }

    return { root, skills: [], source: null };
  }

  /**
   * One-call "workspace init" scan of a bound project directory: merge the
   * project skills from BOTH `.agents/skills` and `.claude/skills` (deduped by
   * name, `.agents/skills` winning) and read the project-root agent
   * instructions file (`AGENTS.md`, else `CLAUDE.md`). Driven server-side at run
   * start via the generic device RPC (not an LLM-visible tool) and cached onto
   * `devices.workingDirs[].workspace`.
   *
   * Approves the root for the `lobe-file://` preview protocol (same as
   * `listProjectSkills`) so the user can later click through to the scanned
   * skills / instructions in the UI.
   */
  @IpcMethod()
  async initWorkspace(params: InitWorkspaceParams): Promise<InitWorkspaceResult> {
    const root = params.scope;
    const sources = ['.agents/skills', '.claude/skills'] as const;

    const seen = new Set<string>();
    const skills: ProjectSkillItem[] = [];
    for (const source of sources) {
      for (const skill of await this.scanSkillsInSource(root, source)) {
        if (seen.has(skill.name)) continue;
        seen.add(skill.name);
        skills.push(skill);
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));

    const instructions = await this.readWorkspaceInstructions(root);

    // Approve regardless of what was found — the run is now bound to this root,
    // so any later click-through to it should resolve through the preview
    // protocol even if the project carries neither skills nor instructions.
    await this.approveProjectRootForPreview(root);

    return { instructions, root, skills };
  }

  /**
   * Check whether a path exists on this device and is a directory, plus its git
   * repo type (`git` / `github` / none). Used to validate a manually-entered
   * working directory from a web / remote client (which can't browse this
   * device's filesystem) before binding it, and to render the right dir icon.
   */
  @IpcMethod()
  async statPath(params: {
    path: string;
  }): Promise<{ exists: boolean; isDirectory: boolean; repoType?: 'git' | 'github' }> {
    try {
      const stats = await stat(params.path);
      if (!stats.isDirectory()) return { exists: true, isDirectory: false };
      const repoType = await detectRepoType(params.path);
      return { exists: true, isDirectory: true, repoType };
    } catch {
      return { exists: false, isDirectory: false };
    }
  }

  /**
   * Read the project-root agent instructions files. Collects every present
   * candidate (`AGENTS.md`, then `CLAUDE.md`) rather than first-match, since both
   * can coexist. Each body is capped so a pathologically large file can't bloat
   * the cached `workingDirs` payload or the injected system role.
   */
  private async readWorkspaceInstructions(
    root: string,
  ): Promise<InitWorkspaceResult['instructions']> {
    const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
    const candidates = ['AGENTS.md', 'CLAUDE.md'] as const;

    const instructions: InitWorkspaceResult['instructions'] = [];
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
  }

  private async approveProjectRootForPreview(root: string) {
    try {
      await this.app.localFileProtocolManager.approveIndexedProjectRoot(root);
    } catch (error) {
      logger.error(`Failed to approve project preview root ${root}:`, error);
    }
  }
}
