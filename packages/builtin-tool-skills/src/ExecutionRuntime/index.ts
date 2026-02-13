import { resourcesTreePrompt } from '@lobechat/prompts';
import {
  type BuiltinServerRuntimeOutput,
  type BuiltinSkill,
  type SkillItem,
  type SkillListItem,
  type SkillResourceContent,
} from '@lobechat/types';

import {
  type CommandResult,
  type ExecScriptParams,
  type ExportFileParams,
  type ImportFromMarketParams,
  type ImportSkillParams,
  type MarketSkillItem,
  type ReadReferenceParams,
  type RunCommandOptions,
  type RunSkillParams,
  type SearchSkillParams,
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
      config?: { description?: string; id?: string; name?: string };
      description: string;
      runInClient?: boolean;
    },
  ) => Promise<CommandResult>;
  exportFile?: (path: string, filename: string) => Promise<ExportFileResult>;
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findById: (id: string) => Promise<SkillItem | undefined>;
  findByName: (name: string) => Promise<SkillItem | undefined>;
  importFromGitHub: (gitUrl: string) => Promise<SkillImportServiceResult>;
  importFromMarket?: (identifier: string) => Promise<SkillImportServiceResult>;
  importFromUrl: (url: string) => Promise<SkillImportServiceResult>;
  importFromZipUrl: (url: string) => Promise<SkillImportServiceResult>;
  onSkillImported?: () => Promise<void>;
  readResource: (id: string, path: string) => Promise<SkillResourceContent>;
  runCommand?: (options: RunCommandOptions) => Promise<CommandResult>;
  searchSkill?: (
    params: SearchSkillParams,
  ) => Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }>;
}

export interface SkillsExecutionRuntimeOptions {
  builtinSkills?: BuiltinSkill[];
  service: SkillRuntimeService;
}

export class SkillsExecutionRuntime {
  private builtinSkills: BuiltinSkill[];
  private service: SkillRuntimeService;

  constructor(options: SkillsExecutionRuntimeOptions) {
    this.service = options.service;
    this.builtinSkills = options.builtinSkills || [];
  }

  async importSkill(args: ImportSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { url, type } = args;

    // Determine import method based on URL and type
    const isGitHub = url.includes('github.com');

    try {
      let result: SkillImportServiceResult;

      if (isGitHub && type === 'url') {
        result = await this.service.importFromGitHub(url);
      } else if (type === 'zip') {
        result = await this.service.importFromZipUrl(url);
      } else {
        result = await this.service.importFromUrl(url);
      }

      // Refresh skills list so the new skill becomes available
      await this.service.onSkillImported?.();

      return {
        content: `Skill "${result.skill.name}" ${result.status} successfully.`,
        state: {
          name: result.skill.name,
          skillId: result.skill.id,
          status: result.status,
          success: true,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to import skill: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async execScript(args: ExecScriptParams): Promise<BuiltinServerRuntimeOutput> {
    const { command, runInClient, description, config } = args;

    // Try new execScript method first (with cloud sandbox support)
    if (this.service.execScript) {
      try {
        const result = await this.service.execScript(command, {
          config,
          description,
          runInClient,
        });

        const output = [result.output, result.stderr].filter(Boolean).join('\n');

        return {
          content: output || '(no output)',
          state: {
            command,
            exitCode: result.exitCode,
            success: result.success,
          },
          success: true,
        };
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
      const result = await this.service.runCommand({ command, runInClient });

      const output = [result.output, result.stderr].filter(Boolean).join('\n');

      return {
        content: output || '(no output)',
        state: {
          command,
          exitCode: result.exitCode,
          success: result.success,
        },
        success: true,
      };
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

    // Validate path to prevent traversal attacks
    if (path.includes('..')) {
      return {
        content: 'Invalid path: path traversal is not allowed',
        success: false,
      };
    }

    try {
      // Resolve id: try findById first, fallback to findByName
      const skill = await this.service.findByName(id);
      if (!skill) {
        return {
          content: `Skill not found: "${id}"`,
          success: false,
        };
      }

      const resource = await this.service.readResource(skill.id, path);
      return {
        content: resource.content,
        state: {
          encoding: resource.encoding,
          fileType: resource.fileType,
          path: resource.path,
          size: resource.size,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to read resource: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async runSkill(args: RunSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { name } = args;

    // Check builtin skills first — no DB query needed
    const builtinSkill = this.builtinSkills.find((s) => s.name === name);
    if (builtinSkill) {
      return {
        content: builtinSkill.content,
        state: {
          description: builtinSkill.description,
          hasResources: false,
          identifier: builtinSkill.identifier,
          name: builtinSkill.name,
        },
        success: true,
      };
    }

    // Fall back to DB query for user/market skills
    const skill = await this.service.findByName(name);

    if (!skill) {
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
      },
      success: true,
    };
  }

  async searchSkill(args: SearchSkillParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.searchSkill) {
      return {
        content: 'Market skill search is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.searchSkill(args);

      if (result.items.length === 0) {
        return {
          content: args.search
            ? `No skills found matching "${args.search}"`
            : 'No skills found in the market',
          state: result,
          success: true,
        };
      }

      // Format results as a readable list
      const skillsList = result.items
        .map(
          (skill, index) =>
            `${index + 1}. **${skill.name}** (${skill.identifier})\n   ${skill.description}${skill.summary ? `\n   Summary: ${skill.summary}` : ''}${skill.repository ? `\n   Repository: ${skill.repository}` : ''}${skill.downloadCount ? `\n   Downloads: ${skill.downloadCount}` : ''}`,
        )
        .join('\n\n');

      return {
        content: `Found ${result.total} skills (page ${result.page}/${Math.ceil(result.total / result.pageSize)}):\n\n${skillsList}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to search skills: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async importFromMarket(args: ImportFromMarketParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifier } = args;

    if (!this.service.importFromMarket) {
      return {
        content: 'Market skill import is not available in this environment.',
        success: false,
      };
    }

    try {
      const result = await this.service.importFromMarket(identifier);

      // Refresh skills list so the new skill becomes available
      await this.service.onSkillImported?.();

      return {
        content: `Skill "${result.skill.name}" ${result.status} successfully from market.`,
        state: {
          name: result.skill.name,
          skillId: result.skill.id,
          status: result.status,
          success: true,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to import skill from market: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
