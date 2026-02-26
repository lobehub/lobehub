import {
  type MarketSkillItem,
  type SearchSkillParams,
  SkillStoreIdentifier,
} from '@lobechat/builtin-tool-skill-store';
import {
  type SkillImportServiceResult,
  SkillStoreExecutionRuntime,
  type SkillStoreRuntimeService,
} from '@lobechat/builtin-tool-skill-store/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { MarketService } from '@/server/services/market';
import { SkillImporter } from '@/server/services/skill/importer';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skill-store-runtime');

class SkillStoreServerRuntimeService implements SkillStoreRuntimeService {
  private importer: SkillImporter;
  private marketService: MarketService;

  constructor(options: { importer: SkillImporter; marketService: MarketService }) {
    this.importer = options.importer;
    this.marketService = options.marketService;
  }

  importFromGitHub = async (gitUrl: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromGitHub({ gitUrl });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromZipUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  searchSkill = async (
    params: SearchSkillParams,
  ): Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }> => {
    log('Searching skills with params: %O', params);

    try {
      const result = await this.marketService.searchSkill(params);
      log('Search skills result: %O', result);
      return result;
    } catch (error) {
      log('Error searching skills: %O', error);
      throw error;
    }
  };

  importFromMarket = async (identifier: string): Promise<SkillImportServiceResult> => {
    log('Importing skill from market: %s', identifier);

    try {
      const downloadUrl = this.marketService.getSkillDownloadUrl(identifier);
      log('Download URL: %s', downloadUrl);

      const result = await this.importFromZipUrl(downloadUrl);
      log('Import from market result: %O', result);
      return result;
    } catch (error) {
      log('Error importing skill from market: %O', error);
      throw error;
    }
  };
}

/**
 * Skill Store Server Runtime
 * Per-request runtime (needs serverDB, userId)
 */
export const skillStoreRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skill Store execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skill Store execution');
    }

    // Fetch market access token from user settings
    let marketAccessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const userSettings = await userModel.getUserSettings();
      marketAccessToken = (userSettings?.market as any)?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const importer = new SkillImporter(context.serverDB, context.userId);
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: context.userId },
    });

    const service = new SkillStoreServerRuntimeService({
      importer,
      marketService,
    });

    return new SkillStoreExecutionRuntime({ service });
  },
  identifier: SkillStoreIdentifier,
};
