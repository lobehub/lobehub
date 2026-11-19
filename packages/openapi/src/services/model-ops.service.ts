import { TRPCError } from '@trpc/server';
import { HTTPException } from 'hono/http-exception';

import { AiModelModel } from '@/database/models/aiModel';
import type { LobeChatDatabase } from '@/database/type';
import { aiModelRouter } from '@/server/routers/lambda/aiModel';

import { BaseService } from '../common/base.service';
import type { DeletedResource } from '../types/common.type';
import type {
  BatchModelItem,
  BatchModelsRequest,
  BatchModelsResult,
  ModelReasoningConfig,
  ModelReasoningConfigResult,
  ReorderModelsRequest,
} from '../types/model-ops.type';
import { MODEL_ABILITY_FLAGS, ModelReasoningConfigSchema } from '../types/model-ops.type';
import { ProviderOpsService } from './provider-ops.service';

/**
 * Model deletion, bulk enable/disable/upsert, model order and the caller's
 * per-model reasoning defaults.
 *
 * Every write runs through the tRPC `aiModel` procedure the provider settings
 * page calls (server-side, without API-key scopes — the REST gate has already
 * narrowed the key), so the workspace admin gate on deletes, the dedupe of
 * auto-generated model ids and the config merges stay in one place. Models
 * are addressed under a provider the caller can address (see
 * `ProviderOpsService.assertProvidersKnown`); a model row outside the caller's
 * scope is 404.
 */
/**
 * Move top-level capability flags (the remote-models card shape) into
 * `abilities`, which is the only place the model row reads them from.
 */
const foldAbilityFlags = (model: BatchModelItem) => {
  const rest: Record<string, unknown> = { ...model };
  const flags: Record<string, boolean> = {};
  for (const flag of MODEL_ABILITY_FLAGS) {
    if (model[flag] !== undefined) flags[flag] = model[flag];
    delete rest[flag];
  }
  if (Object.keys(flags).length === 0) return rest as BatchModelItem;
  return { ...rest, abilities: { ...flags, ...model.abilities } } as BatchModelItem;
};

export class ModelOpsService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get models() {
    return aiModelRouter.createCaller(this.ctx);
  }

  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError || error instanceof HTTPException) throw error;
    this.handleServiceError(error, operation);
  }

  private assertProviderKnown(providerId: string) {
    return new ProviderOpsService(this.db, this.userId, this.workspaceId).assertProvidersKnown([
      providerId,
    ]);
  }

  async deleteModel(providerId: string, modelId: string): Promise<DeletedResource> {
    try {
      const existing = await new AiModelModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findByIdAndProvider(modelId, providerId);
      if (!existing) throw this.createNotFoundError(`Model not found: ${providerId}/${modelId}`);

      await this.models.removeAiModel({ id: modelId, providerId });
      return { deleted: true, id: modelId };
    } catch (error) {
      this.fail(error, 'delete model');
    }
  }

  async batch(request: BatchModelsRequest): Promise<BatchModelsResult> {
    try {
      await this.assertProviderKnown(request.providerId);

      if (request.action === 'upsert') {
        await this.models.batchUpdateAiModels({
          id: request.providerId,
          models: request.models.map(foldAbilityFlags),
        });
        return {
          action: 'upsert',
          modelIds: [...new Set(request.models.map((model) => model.id))],
          providerId: request.providerId,
        };
      }

      // One upsert cannot touch the same row twice, so repeated ids are collapsed.
      const modelIds = [...new Set(request.modelIds)];
      await this.models.batchToggleAiModels({
        enabled: request.action === 'enable',
        id: request.providerId,
        models: modelIds,
      });
      return {
        action: request.action,
        modelIds,
        providerId: request.providerId,
      };
    } catch (error) {
      this.fail(error, 'batch update models');
    }
  }

  async reorder(
    request: ReorderModelsRequest,
  ): Promise<{ modelIds: string[]; providerId: string }> {
    try {
      await this.assertProviderKnown(request.providerId);
      await this.models.updateAiModelOrder({
        providerId: request.providerId,
        sortMap: request.sortMap,
      });

      const modelIds = [...request.sortMap].sort((a, b) => a.sort - b.sort).map((item) => item.id);
      return { modelIds: [...new Set(modelIds)], providerId: request.providerId };
    } catch (error) {
      this.fail(error, 'reorder models');
    }
  }

  /**
   * The caller's own default, shared across workspaces (the preference is
   * keyed by user + provider + model, see `AiModelModel.getModelReasoningConfig`).
   */
  async getReasoningConfig(
    providerId: string,
    modelId: string,
  ): Promise<ModelReasoningConfigResult> {
    try {
      await this.assertProviderKnown(providerId);
      const stored = await this.models.getAiModelReasoningConfig({ id: modelId, providerId });

      return { config: this.projectConfig(stored), modelId, providerId };
    } catch (error) {
      this.fail(error, 'get model reasoning config');
    }
  }

  async updateReasoningConfig(
    providerId: string,
    modelId: string,
    value: ModelReasoningConfig,
  ): Promise<ModelReasoningConfigResult> {
    try {
      await this.assertProviderKnown(providerId);
      await this.models.updateAiModelReasoningConfig({ id: modelId, providerId, value });
      const stored = await this.models.getAiModelReasoningConfig({ id: modelId, providerId });

      return { config: this.projectConfig(stored), modelId, providerId };
    } catch (error) {
      this.fail(error, 'update model reasoning config');
    }
  }

  /** Drop stored keys outside the documented schema (e.g. retired effort options). */
  private projectConfig(stored: unknown): ModelReasoningConfig {
    const config: Record<string, unknown> = {};
    if (!stored || typeof stored !== 'object') return config;

    for (const [key, field] of Object.entries(ModelReasoningConfigSchema.shape)) {
      const value = (stored as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const parsed = (
        field as { safeParse: (v: unknown) => { data?: unknown; success: boolean } }
      ).safeParse(value);
      if (parsed.success) config[key] = parsed.data;
    }
    return config as ModelReasoningConfig;
  }
}
