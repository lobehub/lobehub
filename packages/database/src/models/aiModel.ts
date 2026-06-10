import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type {
  AiModelSortMap,
  AiProviderModelListItem,
  EnabledAiModel,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { AiModelSourceEnum } from 'model-bank';

import type { AiModelSelectItem, NewAiModelItem } from '../schemas';
import { aiModels } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class AiModelModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, aiModels);

  private modelConflictTarget = () =>
    this.workspaceId
      ? {
          // Workspace rows are shared across all members (buildWorkspaceWhere reads
          // by workspace_id only; user_id just records the creator), so the upsert
          // must conflict on (id, provider_id, workspace_id) — not the creator —
          // otherwise two members editing the same model insert duplicate rows.
          target: [aiModels.id, aiModels.providerId, aiModels.workspaceId],
          targetWhere: isNotNull(aiModels.workspaceId),
        }
      : {
          target: [aiModels.id, aiModels.providerId, aiModels.userId],
          targetWhere: isNull(aiModels.workspaceId),
        };

  private modelConflictDoNothingTarget = () =>
    this.workspaceId
      ? {
          // Shared workspace rows conflict on (id, provider_id, workspace_id), not creator.
          target: [aiModels.id, aiModels.providerId, aiModels.workspaceId],
          where: isNotNull(aiModels.workspaceId),
        }
      : {
          target: [aiModels.id, aiModels.providerId, aiModels.userId],
          where: isNull(aiModels.workspaceId),
        };

  /**
   * Helper method to validate if array is empty and return early if needed
   * @param array - Array to validate
   * @returns true if array is empty, false otherwise
   */
  private isEmptyArray(array: unknown[]): boolean {
    return array.length === 0;
  }

  create = async (params: NewAiModelItem) => {
    const [result] = await this.db
      .insert(aiModels)
      .values({
        ...params,
        enabled: params.enabled ?? true, // enabled by default, but respect explicit value
        source: AiModelSourceEnum.Custom,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();

    return result;
  };

  delete = async (id: string, providerId: string) => {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.id, id), eq(aiModels.providerId, providerId), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(aiModels).where(this.ownership());
  };

  query = async () => {
    return this.db.query.aiModels.findMany({
      orderBy: [desc(aiModels.updatedAt)],
      where: this.ownership(),
    });
  };

  getModelListByProviderId = async (providerId: string) => {
    const result = await this.db
      .select({
        abilities: aiModels.abilities,
        config: aiModels.config,
        contextWindowTokens: aiModels.contextWindowTokens,
        description: aiModels.description,
        displayName: aiModels.displayName,
        enabled: aiModels.enabled,
        id: aiModels.id,
        parameters: aiModels.parameters,
        pricing: aiModels.pricing,
        releasedAt: aiModels.releasedAt,
        settings: aiModels.settings,
        source: aiModels.source,
        type: aiModels.type,
      })
      .from(aiModels)
      .where(and(eq(aiModels.providerId, providerId), this.ownership()))
      .orderBy(
        asc(aiModels.sort),
        desc(aiModels.enabled),
        desc(aiModels.releasedAt),
        desc(aiModels.updatedAt),
      );

    return result as AiProviderModelListItem[];
  };

  getAllModels = async () => {
    const data = await this.db
      .select({
        abilities: aiModels.abilities,
        config: aiModels.config,
        contextWindowTokens: aiModels.contextWindowTokens,
        displayName: aiModels.displayName,
        enabled: aiModels.enabled,
        id: aiModels.id,
        parameters: aiModels.parameters,
        providerId: aiModels.providerId,
        releasedAt: aiModels.releasedAt,
        settings: aiModels.settings,
        sort: aiModels.sort,
        source: aiModels.source,
        type: aiModels.type,
      })
      .from(aiModels)
      .where(this.ownership());

    return data as EnabledAiModel[];
  };

  findById = async (id: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(eq(aiModels.id, id), this.ownership()),
    });
  };

  update = async (id: string, providerId: string, value: Partial<AiModelSelectItem>) => {
    return this.db
      .insert(aiModels)
      .values({
        ...value,
        id,
        providerId,
        updatedAt: new Date(),
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .onConflictDoUpdate({
        set: value,
        ...this.modelConflictTarget(),
      });
  };

  toggleModelEnabled = async (value: ToggleAiModelEnableParams) => {
    const now = new Date();
    const insertValues = {
      ...value,
      updatedAt: now,
      userId: this.userId,
      workspaceId: this.workspaceId,
    } as typeof aiModels.$inferInsert;

    if (value.type) insertValues.type = value.type;

    const updateValues: Partial<typeof aiModels.$inferInsert> = {
      enabled: value.enabled,
      updatedAt: now,
    };

    if (value.type) updateValues.type = value.type;

    return this.db
      .insert(aiModels)
      .values(insertValues)
      .onConflictDoUpdate({
        set: updateValues,
        ...this.modelConflictTarget(),
      });
  };

  batchUpdateAiModels = async (providerId: string, models: AiProviderModelListItem[]) => {
    // Early return if models array is empty to prevent database insertion error
    if (this.isEmptyArray(models)) {
      return [];
    }

    const records = models.map(({ id, ...model }) => ({
      ...model,
      id,
      providerId,
      updatedAt: new Date(),
      userId: this.userId,
      workspaceId: this.workspaceId,
    }));

    return this.db
      .insert(aiModels)
      .values(records)
      .onConflictDoNothing({
        ...this.modelConflictDoNothingTarget(),
      })
      .returning();
  };

  batchToggleAiModels = async (providerId: string, models: string[], enabled: boolean) => {
    // Early return if models array is empty to prevent database insertion error
    if (this.isEmptyArray(models)) {
      return;
    }

    // Get default model list to preserve type information
    const { loadModels } = await import('@lobechat/business-model-bank/model-config');
    const defaultModels = await loadModels();
    const defaultModelMap = new Map(defaultModels.map((m) => [`${m.providerId}:${m.id}`, m]));

    // Prepare all records for batch upsert
    const allRecords = models.map((modelId) => {
      const defaultModel =
        defaultModelMap.get(`${providerId}:${modelId}`) ??
        defaultModels.find((model) => model.id === modelId);
      const record: typeof aiModels.$inferInsert = {
        enabled,
        id: modelId,
        providerId,
        // if the model is not in the db, it's a builtin model
        source: AiModelSourceEnum.Builtin,
        updatedAt: new Date(),
        userId: this.userId,
        workspaceId: this.workspaceId,
      };

      // Preserve type if available from default model list
      if (defaultModel?.type) {
        record.type = defaultModel.type;
      }

      return record;
    });

    // Use batch upsert to handle both insert and update in a single query
    return this.db
      .insert(aiModels)
      .values(allRecords)
      .onConflictDoUpdate({
        set: {
          enabled: sql`excluded.enabled`,
          updatedAt: sql`excluded.updated_at`,
        },
        ...this.modelConflictTarget(),
      });
  };

  clearRemoteModels(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.providerId, providerId),
          eq(aiModels.source, AiModelSourceEnum.Remote),
          this.ownership(),
        ),
      );
  }

  clearModelsByProvider(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.providerId, providerId), this.ownership()));
  }

  updateModelsOrder = async (providerId: string, sortMap: AiModelSortMap[]) => {
    // Early return if sortMap array is empty
    if (this.isEmptyArray(sortMap)) {
      return;
    }

    await this.db.transaction(async (tx) => {
      const updates = sortMap.map(({ id, sort, type }) => {
        const now = new Date();
        const insertValues: typeof aiModels.$inferInsert = {
          enabled: true,
          id,
          providerId,
          sort,
          // source: isBuiltin ? 'builtin' : 'custom',
          updatedAt: now,
          userId: this.userId,
          workspaceId: this.workspaceId,
        };

        if (type) insertValues.type = type;

        const updateValues: Partial<typeof aiModels.$inferInsert> = {
          sort,
          updatedAt: now,
        };

        if (type) updateValues.type = type;

        return tx
          .insert(aiModels)
          .values(insertValues)
          .onConflictDoUpdate({
            set: updateValues,
            ...this.modelConflictTarget(),
          });
      });

      await Promise.all(updates);
    });
  };
}
