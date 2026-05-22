import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import { formatCommandResult, resourcesTreePrompt } from '@lobechat/prompts';
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
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

export interface SkillRuntimeService {
  execScript?: (
    command: string,
    options: {
      activatedSkills?: Array<{ description?: string; id: string; name: string }>;
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
 * A project-level skill discovered on the device filesystem
 * (`.agents/skills` / `.claude/skills`). The runtime only needs the name to
 * match an `activateSkill`/`readReference` call and the absolute SKILL.md path
 * to read its content. The directory tree is enumerated lazily on activation
 * via `DeviceFileAccess.listFiles` — keeping it out of the op param payload.
 */
export interface ProjectSkillRuntimeItem {
  /** Absolute path to the skill's SKILL.md on the device. */
  location: string;
  name: string;
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
  builtinSkills?: BuiltinSkill[];
  /** Reads project skill files from the device (local-system over the gateway). */
  deviceFileAccess?: DeviceFileAccess;
  /** Project skills discovered on the device filesystem. */
  projectSkills?: ProjectSkillRuntimeItem[];
  service: SkillRuntimeService;
}

/** Cross-platform dirname for absolute paths (POSIX or Windows separators). */
const getDirname = (filePath: string): string => {
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
 * Hint appended to activated project-skill content so the model knows how to
 * discover the rest of the skill's directory. We deliberately don't enumerate
 * the tree here — the model has `local-system.listFiles` available and can
 * call it on demand, which keeps the op-param payload small.
 */
const buildProjectDirectoryHint = (skillName: string, skillDir: string): string =>
  `## Skill resources

This project skill lives in \`${skillDir}\`. Use \`local-system.listFiles\` on that path to discover reference files, then \`readReference\` with skillName="${skillName}" + the relative path to load any of them.`;

export class SkillsExecutionRuntime {
  private builtinSkills: BuiltinSkill[];
  private projectSkills: ProjectSkillRuntimeItem[];
  private deviceFileAccess?: DeviceFileAccess;
  private service: SkillRuntimeService;

  constructor(options: SkillsExecutionRuntimeOptions) {
    this.service = options.service;
    this.builtinSkills = options.builtinSkills || [];
    this.projectSkills = options.projectSkills || [];
    this.deviceFileAccess = options.deviceFileAccess;
  }

  async execScript(args: ExecScriptParams): Promise<BuiltinServerRuntimeOutput> {
    const { activatedSkills, command, description } = args;

    // Try new execScript method first (with cloud sandbox support)
    if (this.service.execScript) {
      try {
        const result = await this.service.execScript(command, {
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
    const { id, path } = args;

    try {
      // Project skills resolve references relative to the SKILL.md directory,
      // read through the device file access (local-system over the gateway).
      const projectSkill = this.projectSkills.find((s) => s.name === id);
      if (projectSkill) {
        if (!this.deviceFileAccess) {
          return {
            content: `Project skill "${id}" cannot be read: no device file access available.`,
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
            content: `Resource not found in project skill "${id}": "${path}"`,
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

      // DB (user-level) skills win over builtins on name collision — matches
      // the `<available_skills>` dedupe precedence (project > user > agent >
      // builtin) in `aiAgent/index.ts`. Without this, the model would see a
      // user skill in the list but `readReference` would silently read the
      // shadowed builtin's resources.
      const skill = await this.service.findByName(id);
      if (skill) {
        const resource = await this.service.readResource(skill.id, path);
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
      const builtinSkill = this.builtinSkills.find((s) => s.name === id);
      if (builtinSkill?.resources) {
        const meta = builtinSkill.resources[path];
        if (meta?.content !== undefined) {
          return {
            content: meta.content,
            state: {
              encoding: 'utf8',
              fileType: 'text/plain',
              path,
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
    const { name } = args;

    // Project skills (filesystem SKILL.md) take precedence over db/builtin.
    const projectSkill = this.projectSkills.find((s) => s.name === name);
    if (projectSkill) {
      if (!this.deviceFileAccess) {
        return {
          content: `Project skill "${name}" cannot be loaded: no device file access available.`,
          success: false,
        };
      }

      try {
        let content = await this.deviceFileAccess.readFile(projectSkill.location);

        // Don't enumerate the directory here — let the model do it on demand
        // via `local-system.listFiles`. Just point at the skill's directory so
        // it knows where to look. Keeps the op-param payload small and avoids
        // a second deviceProxy round-trip at activation time.
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
            source: 'project',
          },
          success: true,
        };
      } catch (e) {
        return {
          content: `Failed to load project skill "${name}": ${(e as Error).message}`,
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
    const builtinSkill = this.builtinSkills.find((s) => s.name === name);
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

      return {
        content,
        state: {
          description: builtinSkill.description,
          hasResources,
          identifier: builtinSkill.identifier,
          name: builtinSkill.name,
          source: isAgentSkill ? 'agent' : 'builtin',
          ...(builtinSkill.title && { title: builtinSkill.title }),
        },
        success: true,
      };
    }

    const { data: allSkills } = await this.service.findAll();
    const availableSkills = allSkills.map((s) => ({
      description: s.description,
      name: s.name,
    }));

    return {
      content: `Skill not found: "${name}". Available skills: ${JSON.stringify(availableSkills)}`,
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
    });

    return {
      content,
      state: {
        command,
        exitCode: result.exitCode,
        success: result.success,
      },
      success: result.success,
    };
  }
}
