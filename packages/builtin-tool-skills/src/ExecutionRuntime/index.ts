import { AGENT_SKILLS_IDENTIFIER_PREFIX, USER_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import {
  formatCommandResult,
  formatSandboxRecreation,
  resourcesTreePrompt,
} from '@lobechat/prompts';
import type {
  BuiltinServerRuntimeOutput,
  BuiltinSkill,
  SkillItem,
  SkillListItem,
  SkillResourceContent,
} from '@lobechat/types';

import type {
  ActivateSkillParams,
  CommandResult,
  ExecScriptActivatedSkill,
  ExecScriptParams,
  ExportFileParams,
  ReadReferenceParams,
  RunCommandOptions,
  RunCommandParams,
} from '../types';

/**
 * Unified skill service interface for dependency injection.
 * On client side, this is implemented by AgentSkillService.
 * On server side, this is composed from AgentSkillModel + SkillResourceService.
 */
export interface SkillImportServiceResult {
  skill: { id: string; name: string };
  status: 'created' | 'updated' | 'unchanged';
}

export interface ExportFileResult {
  /** Preserve upstream failures for the outer tool error classifier. */
  error?: unknown;
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

/**
 * Host-resolved execution settings for one `execScript` call. Supplied by the
 * caller that owns the run (the client executor from its tool context), never
 * by the model — the manifest exposes none of these.
 */
export interface ExecScriptExecutionOptions {
  /**
   * Confine the command in the device sandbox (the "Local Sandbox" execution
   * environment), with the same semantics as `local-system.runCommand`.
   */
  localSandbox?: boolean;
  /** Let a fenced command reach the package-registry allowlist. */
  localSandboxNetwork?: boolean;
  /**
   * The agent's working directory: the fence root of a sandboxed run (the
   * skill directory is the shared skill cache and stays outside the fence),
   * and its cwd when no skill directory resolves.
   */
  workingDirectory?: string;
}

export interface SkillRuntimeService {
  execScript?: (
    command: string,
    options: ExecScriptExecutionOptions & {
      activatedSkills?: Array<{ description?: string; id?: string; name: string }>;
      description: string;
    },
  ) => Promise<CommandResult>;
  exportFile?: (path: string, filename: string) => Promise<ExportFileResult>;
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findById: (id: string) => Promise<SkillItem | undefined>;
  findByName: (name: string) => Promise<SkillItem | undefined>;
  readResource: (id: string, path: string) => Promise<SkillResourceContent>;
  runCommand?: (options: RunCommandOptions) => Promise<CommandResult>;
}

/**
 * A project- or device-level skill discovered on the execution device
 * filesystem. The runtime only needs the name to match an
 * `activateSkill`/`readReference` call and the absolute SKILL.md path to read
 * its content. The directory tree is enumerated lazily on activation via
 * `DeviceFileAccess.listFiles` — keeping it out of the op param payload.
 */
export interface ProjectSkillRuntimeItem {
  description?: string;
  /** Absolute path to the skill's SKILL.md on the device. */
  location: string;
  name: string;
  source?: 'device' | 'project';
}

/**
 * Device filesystem access used to load project skills. The server wires this
 * to the `local-system` tool over the device gateway, so the runtime stays
 * transport-agnostic — it just needs to read/enumerate files on the device.
 */
export interface DeviceFileAccess {
  /**
   * Recursively enumerate files under `dir`, returning POSIX-style paths
   * relative to `dir`. `readReference` validates user-supplied paths against
   * this list so the model can only read files the project skill actually
   * exposes (no hidden files, no escape outside the skill directory).
   */
  listFiles: (dir: string) => Promise<string[]>;
  /** Read a text file's content from the device. */
  readFile: (path: string) => Promise<string>;
}

export interface SkillsExecutionRuntimeOptions {
  /**
   * Activated skills resolved by the caller from the conversation history.
   * Fallback for `execScript` when the args carry none: the client executor
   * injects stepContext.activatedSkills into the args, but the server runtime
   * registry passes the raw LLM args, so the server factory threads them here
   * instead.
   */
  activatedSkills?: ExecScriptActivatedSkill[];
  builtinSkills?: BuiltinSkill[];
  /** Reads project skill files from the device (local-system over the gateway). */
  deviceFileAccess?: DeviceFileAccess;
  /**
   * Lists metadata for skills resolved lazily via `resolveSkill` (e.g. the
   * user's skill library). Invoked only when `activateSkill` misses, so the
   * not-found candidate list stays complete without loading the library up front.
   */
  listAvailableSkills?: () => Promise<Array<{ description?: string; name: string }>>;
  /** Filesystem skills discovered on the execution device. */
  projectSkills?: ProjectSkillRuntimeItem[];
  /**
   * Resolves a skill by name when it is not among `builtinSkills`: a library
   * too large to load up front (the user's own skills) is read on demand, only
   * for the name a call asks for.
   */
  resolveSkill?: (name: string) => Promise<BuiltinSkill | undefined>;
  service: SkillRuntimeService;
}

/**
 * Cross-platform dirname for absolute paths (POSIX or Windows separators).
 * Exported for the server skills runtime, which resolves device paths that may
 * use either separator — server-side `path.dirname` would mishandle `\`.
 */
export const getDirname = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx === -1 ? '' : filePath.slice(0, idx);
};

/** Join a directory with a relative path, preserving the directory's separator. */
const joinPath = (dir: string, rel: string): string => {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -sep.length) : dir;
  return `${trimmed}${sep}${rel}`;
};

/**
 * Normalize a user-supplied relative path to POSIX form: backslashes → `/`,
 * trim leading `./` and slashes. Used to compare requested paths against the
 * skill's `listFiles` result (which is canonicalized the same way by the
 * device-side enumerator) and to detect hidden segments.
 */
const normalizeRelativePath = (rel: string): string =>
  rel
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');

/** True when any segment in `rel` is hidden (starts with `.`) — `.env`, `.git/...`. */
const hasHiddenSegment = (rel: string): boolean =>
  rel.split('/').some((seg) => seg.startsWith('.'));

/**
 * Case-insensitive lookup by `name`. The model frequently emits a different
 * casing than what's registered (e.g. `Agent-Browser` for `agent-browser`,
 * `lobehub` for `LobeHub`); normalize both sides before comparing.
 */
const findByNameCI = <T extends { name: string }>(items: T[], target: string): T | undefined => {
  const lower = target.toLowerCase();
  return items.find((s) => s.name.toLowerCase() === lower);
};

/** How many skills an `activateSkill` miss lists, and how much of each description. */
const MAX_MISS_CANDIDATES = 30;
const MAX_MISS_DESCRIPTION_LENGTH = 160;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A skill name without its source prefix (`user-skills:`, `agent-skills:`). */
const bareName = (name: string): string => name.toLowerCase().slice(name.lastIndexOf(':') + 1);

/**
 * Skills whose name shares a word with the requested one, then the rest, each
 * group keeping its order. A missed name is usually a near miss: a dropped
 * prefix (`weekly-report` for `user-skills:weekly-report`) or a reworded one.
 * Prefixes and the word "skill" say nothing about which skill was meant, so
 * neither counts as a shared word.
 */
const rankByResemblance = <T extends { name: string }>(items: T[], requested: string): T[] => {
  const words = bareName(requested)
    .split(/[^\da-z]+/)
    .filter((word) => word.length > 2 && word !== 'skill' && word !== 'skills');
  if (words.length === 0) return items;

  const resembles = (item: T) => {
    const bare = bareName(item.name);
    return words.some((word) => bare.includes(word));
  };
  return [...items.filter((item) => resembles(item)), ...items.filter((item) => !resembles(item))];
};

/**
 * Hint appended to activated filesystem-skill content so the model knows how to
 * discover the rest of the skill's directory. We deliberately don't enumerate
 * the tree here — the model has `local-system.globFiles` available and can
 * call it on demand, which keeps the op-param payload small.
 */
const buildProjectDirectoryHint = (skillName: string, skillDir: string): string =>
  `## Skill resources

This filesystem skill lives in \`${skillDir}\`. Use \`local-system.globFiles\` with scope="${skillDir}" and pattern="**/*" to discover reference files, then \`readReference\` with id="${skillName}" + the relative path to load any of them.`;

export class SkillsExecutionRuntime {
  private activatedSkills?: ExecScriptActivatedSkill[];
  private builtinSkills: BuiltinSkill[];
  private projectSkills: ProjectSkillRuntimeItem[];
  private deviceFileAccess?: DeviceFileAccess;
  private listAvailableSkills?: () => Promise<Array<{ description?: string; name: string }>>;
  private resolveSkill?: (name: string) => Promise<BuiltinSkill | undefined>;
  private service: SkillRuntimeService;

  constructor(options: SkillsExecutionRuntimeOptions) {
    this.service = options.service;
    this.activatedSkills = options.activatedSkills;
    this.builtinSkills = options.builtinSkills || [];
    this.projectSkills = options.projectSkills || [];
    this.deviceFileAccess = options.deviceFileAccess;
    this.listAvailableSkills = options.listAvailableSkills;
    this.resolveSkill = options.resolveSkill;
  }

  /** A preloaded builtin-shaped skill (by name or identifier), else one the resolver reads on demand. */
  private findBuiltinSkill = async (target: string): Promise<BuiltinSkill | undefined> => {
    const lower = target.toLowerCase();
    const preloaded = this.builtinSkills.find(
      (s) => s.name.toLowerCase() === lower || s.identifier.toLowerCase() === lower,
    );
    if (preloaded || !this.resolveSkill) return preloaded;
    const resolved = await this.resolveSkill(target);
    if (resolved) this.builtinSkills = [...this.builtinSkills, resolved];
    return resolved;
  };

  async execScript(
    args: ExecScriptParams,
    execution?: ExecScriptExecutionOptions,
  ): Promise<BuiltinServerRuntimeOutput> {
    const { command, description } = args;
    // Args win when the caller (client executor) already injected stepContext;
    // the constructor option covers the server path where args are raw LLM output.
    const activatedSkills = args.activatedSkills ?? this.activatedSkills;

    // Try new execScript method first (with cloud sandbox support)
    if (this.service.execScript) {
      try {
        const result = await this.service.execScript(command, {
          ...execution,
          activatedSkills,
          description,
        });

        return this.formatCommandOutput(command, result);
      } catch (e) {
        return {
          content: `Failed to execute command: ${(e as Error).message}`,
          success: false,
        };
      }
    }

    // Fallback to legacy runCommand method
    if (!this.service.runCommand) {
      return {
        content: 'Command execution is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.runCommand({ command });
      return this.formatCommandOutput(command, result);
    } catch (e) {
      return {
        content: `Failed to execute command: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async runCommand(args: RunCommandParams): Promise<BuiltinServerRuntimeOutput> {
    const { command } = args;

    if (!this.service.runCommand) {
      return {
        content: 'Command execution is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.runCommand({ command });
      return this.formatCommandOutput(command, result);
    } catch (e) {
      return {
        content: `Failed to execute command: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async exportFile(args: ExportFileParams): Promise<BuiltinServerRuntimeOutput> {
    const { path, filename } = args;

    if (!this.service.exportFile) {
      return {
        content: 'File export is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.exportFile(path, filename);

      if (!result.success) {
        return {
          content: `Failed to export file: ${filename}`,
          error: result.error,
          success: false,
        };
      }

      return {
        content: `File exported successfully: ${filename}\nDownload URL: ${result.url || 'N/A'}`,
        state: {
          fileId: result.fileId,
          filename: result.filename,
          mimeType: result.mimeType,
          size: result.size,
          url: result.url,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to export file: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async readReference(args: ReadReferenceParams): Promise<BuiltinServerRuntimeOutput> {
    const { id, path } = args ?? {};

    if (!id || typeof id !== 'string') {
      return {
        content: 'Invalid arguments: "id" (the skill ID or name) is required.',
        success: false,
      };
    }

    if (!path || typeof path !== 'string') {
      return {
        content: 'Invalid arguments: "path" (the reference file path) is required.',
        success: false,
      };
    }

    try {
      // Project/device skills resolve references relative to the SKILL.md
      // directory, read through device file access (local-system over the
      // gateway).
      const projectSkill = findByNameCI(this.projectSkills, id);
      if (projectSkill) {
        if (!this.deviceFileAccess) {
          return {
            content: `Filesystem skill "${id}" cannot be read: no device file access available.`,
            success: false,
          };
        }

        // Normalize and reject obviously-unsafe shapes up front. The
        // `listFiles` membership check below is the real authority, but
        // failing fast here keeps the error message specific.
        const normalized = normalizeRelativePath(path);
        if (!normalized || normalized.includes('..') || hasHiddenSegment(normalized)) {
          return {
            content: `Invalid path: "${path}" is not a permitted skill resource`,
            success: false,
          };
        }

        // Enumerate the skill directory and only allow files the device
        // surface advertises. Without this, a model could request any path
        // under the skill dir (e.g. `.env`, `node_modules/…`) that was never
        // declared as a skill resource. The device-side enumerator already
        // filters hidden files; we re-check here as defense in depth.
        const skillDir = getDirname(projectSkill.location);
        const allowed = new Set(
          (await this.deviceFileAccess.listFiles(skillDir)).map((f) => normalizeRelativePath(f)),
        );
        if (!allowed.has(normalized)) {
          return {
            content: `Resource not found in filesystem skill "${id}": "${path}"`,
            success: false,
          };
        }

        const fullPath = joinPath(skillDir, normalized);
        const content = await this.deviceFileAccess.readFile(fullPath);
        return {
          content,
          state: { encoding: 'utf8', fileType: 'text/plain', fullPath, path: normalized },
          success: true,
        };
      }

      // For non-project skills, keep the traversal guard. Builtin / user
      // skills look paths up via an explicit `resources` map or service, so
      // the `..` substring is the only realistic traversal vector.
      if (path.includes('..')) {
        return {
          content: 'Invalid path: path traversal is not allowed',
          success: false,
        };
      }

      const normalizedPath = normalizeRelativePath(path);

      // DB (user-level) skills win over builtins on name collision — matches
      // the `<available_skills>` dedupe precedence (project > user > agent >
      // builtin) in `aiAgent/index.ts`. Without this, the model would see a
      // user skill in the list but `readReference` would silently read the
      // shadowed builtin's resources. Accept either skill name or DB id to
      // match the manifest contract ("The skill ID or name returned by activateSkill").
      const skill = (await this.service.findByName(id)) ?? (await this.service.findById(id));
      if (skill) {
        const resourcePath =
          skill.resources && !(path in skill.resources) && normalizedPath in skill.resources
            ? normalizedPath
            : path;
        const resource = await this.service.readResource(skill.id, resourcePath);
        return {
          content: resource.content,
          state: {
            encoding: resource.encoding,
            fileType: resource.fileType,
            fullPath: resource.fullPath,
            path: resource.path,
            size: resource.size,
          },
          success: true,
        };
      }

      // Fall back to builtin skills (includes agent-document skill bundles
      // via the `agent-skills:` identifier prefix).
      const builtinSkill = await this.findBuiltinSkill(id);
      if (builtinSkill) {
        const resolvedPath =
          builtinSkill.resources &&
          !(path in builtinSkill.resources) &&
          normalizedPath in builtinSkill.resources
            ? normalizedPath
            : path;
        const meta = builtinSkill.resources?.[resolvedPath];
        if (meta?.content !== undefined) {
          return {
            content: meta.content,
            state: {
              encoding: 'utf8',
              fileType: 'text/plain',
              path: resolvedPath,
              size: meta.size,
            },
            success: true,
          };
        }
        return {
          content: `Resource not found: "${path}" in builtin skill "${id}"`,
          success: false,
        };
      }

      return {
        content: `Skill not found: "${id}"`,
        success: false,
      };
    } catch (e) {
      return {
        content: `Failed to read resource: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async activateSkill(args: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { name } = args ?? {};

    if (!name || typeof name !== 'string') {
      return {
        content: 'Invalid arguments: "name" (the skill name) is required.',
        success: false,
      };
    }

    // Filesystem skills (project/device SKILL.md) take precedence over db/builtin.
    const projectSkill = findByNameCI(this.projectSkills, name);
    if (projectSkill) {
      if (!this.deviceFileAccess) {
        return {
          content: `Filesystem skill "${name}" cannot be loaded: no device file access available.`,
          success: false,
        };
      }

      try {
        let content = await this.deviceFileAccess.readFile(projectSkill.location);

        // Don't enumerate the directory here — let the model do it on demand
        // via `local-system.globFiles`. Just point at the skill's directory so
        // it knows where to look. Keeps the op-param payload small and avoids
        // a second deviceGateway round-trip at activation time.
        const skillDir = getDirname(projectSkill.location);
        if (skillDir) {
          content += '\n\n' + buildProjectDirectoryHint(name, skillDir);
        }

        return {
          content,
          state: {
            hasResources: false,
            location: projectSkill.location,
            name,
            source: projectSkill.source ?? 'project',
          },
          success: true,
        };
      } catch (e) {
        return {
          content: `Failed to load filesystem skill "${name}": ${(e as Error).message}`,
          success: false,
        };
      }
    }

    // DB (user-level) skills win over builtins on name collision — matches
    // the `<available_skills>` dedupe precedence (project > user > agent >
    // builtin) in `aiAgent/index.ts`. Without this, the model would see a
    // user skill in the list but `activateSkill` would silently load the
    // shadowed builtin instead.
    const skill = await this.service.findByName(name);
    if (skill) {
      const hasResources = !!(skill.resources && Object.keys(skill.resources).length > 0);
      let content = skill.content || '';

      if (hasResources && skill.resources) {
        content += '\n\n' + resourcesTreePrompt(skill.name, skill.resources);
      }

      return {
        content,
        state: {
          description: skill.description || undefined,
          hasResources,
          id: skill.id,
          name: skill.name,
          source: 'user',
        },
        success: true,
      };
    }

    // Fall back to builtin skills (includes agent-document skill bundles via
    // the `agent-skills:` identifier prefix).
    const builtinSkill = await this.findBuiltinSkill(name);
    if (builtinSkill) {
      let content = builtinSkill.content;
      const hasResources = !!(
        builtinSkill.resources && Object.keys(builtinSkill.resources).length > 0
      );

      if (hasResources && builtinSkill.resources) {
        content += '\n\n' + resourcesTreePrompt(builtinSkill.name, builtinSkill.resources);
      }

      // Agent-document skill bundles flow through the builtin path with the
      // `agent-skills:` prefix on their identifier. Tag the result so the
      // inspector can pick the right label ("Activate Agent Skill") and prefer
      // the friendly `title` over the raw `agent-skills:<filename>` name.
      const isAgentSkill = builtinSkill.identifier.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX);
      // The user's own skill library rides the same path under `user-skills:`.
      const isUserSkill = builtinSkill.identifier.startsWith(USER_SKILLS_IDENTIFIER_PREFIX);

      return {
        content,
        state: {
          description: builtinSkill.description,
          hasResources,
          identifier: builtinSkill.identifier,
          name: builtinSkill.name,
          source: isAgentSkill ? 'agent' : isUserSkill ? 'user' : 'builtin',
          ...(builtinSkill.title && { title: builtinSkill.title }),
        },
        success: true,
      };
    }

    const [{ data: dbSkills }, extraSkills] = await Promise.all([
      this.service.findAll(),
      this.listAvailableSkills ? this.listAvailableSkills() : Promise.resolve([]),
    ]);

    // Aggregate every skill source in activation-precedence order
    // (project/device > DB > builtin/agent > lazy user-skill library),
    // deduplicating by case-insensitive name so the model can recover from a
    // miss regardless of where the skill lives.
    const seen = new Set<string>();
    const availableSkills: Array<{ description?: string; name: string }> = [];
    const addCandidate = (candidate: { description?: string | null; name: string }) => {
      const key = candidate.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      availableSkills.push({
        ...(candidate.description
          ? { description: truncate(candidate.description, MAX_MISS_DESCRIPTION_LENGTH) }
          : {}),
        name: candidate.name,
      });
    };

    for (const projectSkill of this.projectSkills) addCandidate(projectSkill);
    for (const dbSkill of dbSkills) addCandidate(dbSkill);
    for (const builtin of this.builtinSkills) addCandidate(builtin);
    for (const extra of extraSkills) addCandidate(extra);

    // A skill library has no size limit and a miss is paid for in tokens, so
    // the list is capped. Names that resemble the request go first: a cap in
    // source order alone could cut off the very skill a typo was aiming at.
    const listed = rankByResemblance(availableSkills, name).slice(0, MAX_MISS_CANDIDATES);
    const omitted = availableSkills.length - listed.length;

    return {
      content:
        `Skill not found: "${name}". Available skills: ${JSON.stringify(listed)}` +
        (omitted > 0 ? ` (${omitted} more not listed)` : ''),
      success: false,
    };
  }

  /**
   * Format command result using the shared formatCommandResult from @lobechat/prompts.
   * This ensures consistent content format across all runtimes.
   */
  private formatCommandOutput(command: string, result: CommandResult): BuiltinServerRuntimeOutput {
    const content = formatCommandResult({
      stderr: result.stderr,
      stdout: result.output,
      success: result.success,
      exitCode: result.exitCode,
      // Renders the saved-output paths when the shell truncated the inline
      // stream — without them the full output is unreachable.
      outputFiles: result.outputFiles,
      // Surfaces the still-running message with a pollable handle when the
      // command outlived the observation window (exitCode undefined).
      shellId: result.shellId,
    });

    return {
      content: formatSandboxRecreation(content, result.sessionExpiredAndRecreated),
      error: result.error,
      state: {
        command,
        ...(result.sessionExpiredAndRecreated && { sessionExpiredAndRecreated: true }),
        ...(result.executionEnv && { executionEnv: result.executionEnv }),
        exitCode: result.exitCode,
        ...(result.outputFiles && { outputFiles: result.outputFiles }),
        ...(result.shellId && { shellId: result.shellId }),
        success: result.success,
      },
      success: result.success,
    };
  }
}
