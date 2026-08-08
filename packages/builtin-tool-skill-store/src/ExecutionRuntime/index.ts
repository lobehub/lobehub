import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ImportFromMarketParams,
  ImportSkillParams,
  MarketSkillItem,
  SearchSkillParams,
} from '../types';

export interface SkillImportServiceResult {
  skill: { id: string; name: string };
  status: 'created' | 'updated' | 'unchanged';
}

export interface SkillStoreRuntimeService {
  importFromGitHub: (gitUrl: string) => Promise<SkillImportServiceResult>;
  importFromMarket?: (identifier: string) => Promise<SkillImportServiceResult>;
  importFromUrl: (url: string) => Promise<SkillImportServiceResult>;
  importFromZipUrl: (url: string) => Promise<SkillImportServiceResult>;
  onSkillImported?: () => Promise<void>;
  searchSkill?: (
    params: SearchSkillParams,
  ) => Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }>;
}

export interface SkillStoreExecutionRuntimeOptions {
  service: SkillStoreRuntimeService;
}

export class SkillStoreExecutionRuntime {
  private service: SkillStoreRuntimeService;

  constructor(options: SkillStoreExecutionRuntimeOptions) {
    this.service = options.service;
  }

  /**
   * Notify the host that a skill was imported so it can refresh client state
   * (e.g. the agent skills list). Invoked from the executor's `onAfterCall`
   * lifecycle hook, which fires on `tool_end` regardless of whether the import
   * actually ran client- or server-side — covering the server-runtime path the
   * inline service callback can't reach.
   */
  notifyImported(): Promise<void> {
    return this.service.onSkillImported?.() ?? Promise.resolve();
  }

  async importSkill(args: ImportSkillParams): Promise<BuiltinServerRuntimeOutput> {
    const { url, type } = args;

    // Determine import method based on URL and type
    let isGitHub = false;
    try {
      const hostname = new URL(url).hostname;
      isGitHub = hostname === 'github.com' || hostname.endsWith('.github.com');
    } catch {
      // invalid URL — fall through to importFromUrl
    }

    try {
      let result: SkillImportServiceResult;

      if (isGitHub && type === 'url') {
        result = await this.service.importFromGitHub(url);
      } else if (type === 'zip') {
        result = await this.service.importFromZipUrl(url);
      } else {
        result = await this.service.importFromUrl(url);
      }

      // Refresh the skills list for the direct/local client invoke path
      // (`invokeBuiltinTool`), which never dispatches the executor's
      // `onAfterCall`. The gateway path covers itself via `onAfterCall` and
      // routes import through the server runtime, so this never double-fires.
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
          content: args.q
            ? `No skills found matching "${args.q}"`
            : 'No skills found in the market',
          state: result,
          success: true,
        };
      }

      // Format results as a readable list
      const skillsList = result.items
        .map(
          (skill, index) =>
            `${index + 1}. **${skill.name}** (${skill.identifier})\n   ${skill.description}${skill.summary ? `\n   Summary: ${skill.summary}` : ''}${skill.repository ? `\n   Repository: ${skill.repository}` : ''}${skill.installCount ? `\n   Installs: ${skill.installCount}` : ''}`,
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

      // See importSkill: refresh for the direct/local client invoke path.
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
