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
import {
  emitToolOutcomeSafely,
  resolveToolOutcomeScope,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { MarketService } from '@/server/services/market';
import { SkillImporter } from '@/server/services/skill/importer';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skill-store-runtime');

class SkillStoreServerRuntimeService implements SkillStoreRuntimeService {
  private agentId?: string;
  private emitOutcome?: typeof emitToolOutcomeSafely;
  private messageId?: string;
  private importer: SkillImporter;
  private marketService: MarketService;
  private operationId?: string;
  private taskId?: string;
  private toolCallId?: string;
  private topicId?: string;
  private userId: string;

  constructor(options: {
    agentId?: string;
    emitOutcome?: typeof emitToolOutcomeSafely;
    importer: SkillImporter;
    marketService: MarketService;
    messageId?: string;
    operationId?: string;
    taskId?: string;
    toolCallId?: string;
    topicId?: string;
    userId: string;
  }) {
    this.agentId = options.agentId;
    this.emitOutcome = options.emitOutcome;
    this.messageId = options.messageId;
    this.importer = options.importer;
    this.marketService = options.marketService;
    this.operationId = options.operationId;
    this.taskId = options.taskId;
    this.toolCallId = options.toolCallId;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  private emitSkillOutcome = async (input: {
    apiName: string;
    errorReason?: string;
    intentClass?: string;
    objectId?: string;
    relation?: string;
    status: 'failed' | 'succeeded';
    summary: string;
    toolAction: string;
  }) => {
    const { scope, scopeKey } = resolveToolOutcomeScope({
      agentId: this.agentId,
      taskId: this.taskId,
      topicId: this.topicId,
      userId: this.userId,
    });

    await this.emitOutcome?.({
      apiName: input.apiName,
      context: { agentId: this.agentId, userId: this.userId },
      domainKey: 'skill:market-skill',
      errorReason: input.errorReason,
      identifier: SkillStoreIdentifier,
      intentClass: input.intentClass,
      messageId: this.messageId,
      operationId: this.operationId,
      policyStateStore: redisPolicyStateStore,
      relatedObjects: input.objectId
        ? [{ objectId: input.objectId, objectType: 'skill', relation: input.relation }]
        : undefined,
      scope,
      scopeKey,
      status: input.status,
      summary: input.summary,
      ttlSeconds: 7 * 24 * 60 * 60,
      toolAction: input.toolAction,
      toolCallId: this.toolCallId,
    });
  };

  importFromGitHub = async (gitUrl: string): Promise<SkillImportServiceResult> => {
    try {
      const result = await this.importer.importFromGitHub({ gitUrl });
      await this.emitSkillOutcome({
        apiName: 'importFromGitHub',
        intentClass: 'tool_command',
        objectId: result.skill.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Skill store imported a GitHub skill.',
        toolAction: 'import',
      });
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    } catch (error) {
      await this.emitSkillOutcome({
        apiName: 'importFromGitHub',
        errorReason: (error as Error).message,
        intentClass: 'tool_command',
        status: 'failed',
        summary: 'Skill store failed to import a GitHub skill.',
        toolAction: 'import',
      });
      throw error;
    }
  };

  importFromUrl = async (url: string): Promise<SkillImportServiceResult> => {
    try {
      const result = await this.importer.importFromUrl({ url });
      await this.emitSkillOutcome({
        apiName: 'importFromUrl',
        intentClass: 'tool_command',
        objectId: result.skill.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Skill store imported a skill from URL.',
        toolAction: 'import',
      });
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    } catch (error) {
      await this.emitSkillOutcome({
        apiName: 'importFromUrl',
        errorReason: (error as Error).message,
        intentClass: 'tool_command',
        status: 'failed',
        summary: 'Skill store failed to import a skill from URL.',
        toolAction: 'import',
      });
      throw error;
    }
  };

  importFromZipUrl = async (url: string): Promise<SkillImportServiceResult> => {
    try {
      const result = await this.importer.importFromUrl({ url });
      await this.emitSkillOutcome({
        apiName: 'importFromZipUrl',
        intentClass: 'tool_command',
        objectId: result.skill.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Skill store imported a zipped skill.',
        toolAction: 'import',
      });
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    } catch (error) {
      await this.emitSkillOutcome({
        apiName: 'importFromZipUrl',
        errorReason: (error as Error).message,
        intentClass: 'tool_command',
        status: 'failed',
        summary: 'Skill store failed to import a zipped skill.',
        toolAction: 'import',
      });
      throw error;
    }
  };

  searchSkill = async (
    params: SearchSkillParams,
  ): Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }> => {
    log('Searching skills with params: %O', params);

    try {
      const result = await this.marketService.searchSkill(params);
      log('Search skills result: %O', result);
      await this.emitSkillOutcome({
        apiName: 'searchSkill',
        status: 'succeeded',
        summary: 'Skill store searched marketplace skills.',
        toolAction: 'search',
      });
      // Transform SDK response to match expected interface
      return {
        items: result.items,
        page: result.currentPage,
        pageSize: result.pageSize,
        total: result.totalCount,
      };
    } catch (error) {
      log('Error searching skills: %O', error);
      await this.emitSkillOutcome({
        apiName: 'searchSkill',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Skill store failed to search marketplace skills.',
        toolAction: 'search',
      });
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
      agentId: context.agentId,
      emitOutcome: emitToolOutcomeSafely,
      importer,
      marketService,
      messageId: context.messageId,
      operationId: context.operationId,
      taskId: context.taskId,
      toolCallId: context.toolCallId,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new SkillStoreExecutionRuntime({ service });
  },
  identifier: SkillStoreIdentifier,
};
