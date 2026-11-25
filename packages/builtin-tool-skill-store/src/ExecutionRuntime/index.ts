import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ImportFromMarketParams,
  ImportSkillParams,
  MarketSkillItem,
  SearchSkillParams,
} from '../types';

const DEFAULT_SEARCH_PAGE_SIZE = 10;
const MAX_SKILL_OVERVIEW_LENGTH = 300;

const pickNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const truncateText = (text: string, maxLength: number): string => {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const formatSkillOverview = (skill: MarketSkillItem): string | undefined => {
  const raw = pickNonEmptyString(skill.summary) ?? pickNonEmptyString(skill.description);
  return raw ? truncateText(raw, MAX_SKILL_OVERVIEW_LENGTH) : undefined;
};

export type SkillStoreSearchServiceParams = Omit<SearchSkillParams, 'query'>;

export interface SkillImportServiceResult {
  skill: { description?: string | null; id: string; name: string };
  status: 'created' | 'updated' | 'unchanged';
}

export interface SkillStoreRuntimeService {
  importFromGitHub: (gitUrl: string) => Promise<SkillImportServiceResult>;
  importFromMarket?: (identifier: string) => Promise<SkillImportServiceResult>;
  importFromUrl: (url: string) => Promise<SkillImportServiceResult>;
  importFromZipUrl: (url: string) => Promise<SkillImportServiceResult>;
  onSkillImported?: () => Promise<void>;
  searchSkill?: (
    params: SkillStoreSearchServiceParams,
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

      const description = result.skill.description?.trim() || undefined;
      return {
        content: description
          ? `Skill "${result.skill.name}" ${result.status} successfully.\nDescription: ${description}`
          : `Skill "${result.skill.name}" ${result.status} successfully.`,
        state: {
          ...(description && { description }),
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

  async searchSkill(args: SearchSkillParams = {}): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.searchSkill) {
      return {
        content: 'Market skill search is not available in this environment.',
        success: false,
      };
    }

    const resolvedQuery = pickNonEmptyString(args.query) ?? pickNonEmptyString(args.q);
    const pageSize =
      typeof args.pageSize === 'number' && Number.isFinite(args.pageSize) && args.pageSize > 0
        ? args.pageSize
        : DEFAULT_SEARCH_PAGE_SIZE;

    const serviceParams: SkillStoreSearchServiceParams = {
      ...(args.locale ? { locale: args.locale } : {}),
      ...(args.order ? { order: args.order } : {}),
      ...(args.page !== undefined ? { page: args.page } : {}),
      pageSize,
      ...(resolvedQuery ? { q: resolvedQuery } : {}),
      ...(args.sort ? { sort: args.sort } : {}),
    };

    try {
      const result = await this.service.searchSkill(serviceParams);

      if (result.items.length === 0) {
        return {
          content: resolvedQuery
            ? `No skills found matching "${resolvedQuery}"`
            : 'No skills found in the market',
          state: result,
          success: true,
        };
      }

      // Format results concisely: prefer summary over description to avoid duplicating both
      const skillsList = result.items
        .map((skill, index) => {
          const overview = formatSkillOverview(skill);
          const lines = [`${index + 1}. **${skill.name}** (${skill.identifier})`];
          if (overview) lines.push(`   ${overview}`);
          if (skill.repository) lines.push(`   Repository: ${skill.repository}`);
          if (skill.installCount) lines.push(`   Installs: ${skill.installCount}`);
          return lines.join('\n');
        })
        .join('\n\n');

      const totalPages = result.pageSize > 0 ? Math.ceil(result.total / result.pageSize) : 1;
      const header = resolvedQuery
        ? `Found ${result.total} skills for "${resolvedQuery}" (page ${result.page}/${totalPages}):`
        : `Found ${result.total} skills (browse mode, no query, page ${result.page}/${totalPages}):`;

      return {
        content: `${header}\n\n${skillsList}`,
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

      const description = result.skill.description?.trim() || undefined;
      return {
        content: description
          ? `Skill "${result.skill.name}" ${result.status} successfully from market.\nDescription: ${description}`
          : `Skill "${result.skill.name}" ${result.status} successfully from market.`,
        state: {
          ...(description && { description }),
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
