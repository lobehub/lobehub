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
