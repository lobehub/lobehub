import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type {
  AiModelSortMap,
  AiProviderModelListItem,
  EnabledAiModel,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { AiModelSourceEnum, normalizeAiModelType } from 'model-bank';

import type { AiModelSelectItem, NewAiModelItem } from '../schemas';
import { aiModels } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class AiModelModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private scopeWhere = () =>
    this.workspaceId
      ? and(eq(aiModels.userId, this.userId), eq(aiModels.workspaceId, this.workspaceId))
      : and(eq(aiModels.userId, this.userId), isNull(aiModels.workspaceId));

  private scopedValues = () => ({
    userId: this.userId,
    ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
  });

  private conflictTarget = () => ({
    target: this.workspaceId
      ? [aiModels.id, aiModels.providerId, aiModels.userId, aiModels.workspaceId]
      : [aiModels.id, aiModels.providerId, aiModels.userId],
    targetWhere: this.workspaceId ? isNotNull(aiModels.workspaceId) : isNull(aiModels.workspaceId),
  });

  private conflictDoNothingTarget = () => ({
    target: this.workspaceId
      ? [aiModels.id, aiModels.providerId, aiModels.userId, aiModels.workspaceId]
      : [aiModels.id, aiModels.providerId, aiModels.userId],
    where: this.workspaceId ? isNotNull(aiModels.workspaceId) : isNull(aiModels.workspaceId),
  });

  /**
   * The database column is varchar(10). Remote model feeds can send ISO timestamps
   * such as `2025-01-01T00:00:00.000Z`, which PostgreSQL rejects on insert.
   */
  private normalizeReleasedAt(releasedAt?: string | null) {
    if (!releasedAt) return releasedAt;

    return releasedAt.length > 10 ? releasedAt.slice(0, 10) : releasedAt;
  }

  private normalizeAiModelValues<T extends { releasedAt?: string | null; type?: string | null }>(
    values: T,
  ): T {
    return {
      ...values,
      releasedAt: this.normalizeReleasedAt(values.releasedAt),
      // Heal the legacy `stt` value on write (lazy migration): any natural
      // create/update persists the standard `asr`. `undefined` is left as-is so
      // partial updates don't clobber the column (drizzle skips undefined).
      type: normalizeAiModelType(values.type),
    };
  }

  /**
   * Helper method to validate if array is empty and return early if needed
   * @param array - Array to validate
   * @returns true if array is empty, false otherwise
   */
  private isEmptyArray(array: unknown[]): boolean {
    return array.length === 0;
  }

  create = async (params: NewAiModelItem) => {
    const values = this.normalizeAiModelValues(params);

    const [result] = await this.db
      .insert(aiModels)
      .values({
        ...values,
        enabled: params.enabled ?? true, // enabled by default, but respect explicit value
        source: AiModelSourceEnum.Custom,
        ...this.scopedValues(),
      })
      .returning();

    return result;
  };

  delete = async (id: string, providerId: string) => {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.id, id), eq(aiModels.providerId, providerId), this.scopeWhere()));
  };

  deleteAll = async () => {
    return this.db.delete(aiModels).where(this.scopeWhere());
  };

  query = async () => {
    return this.db.query.aiModels.findMany({
      orderBy: [desc(aiModels.updatedAt)],
      where: this.scopeWhere(),
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
      .where(and(eq(aiModels.providerId, providerId), this.scopeWhere()))
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
      .where(this.scopeWhere());

    return data as EnabledAiModel[];
  };

  findById = async (id: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(eq(aiModels.id, id), this.scopeWhere()),
    });
  };

  findByIdAndProvider = async (id: string, providerId: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(eq(aiModels.id, id), eq(aiModels.providerId, providerId), this.scopeWhere()),
    });
  };

  update = async (id: string, providerId: string, value: Partial<AiModelSelectItem>) => {
    const normalizedValue = this.normalizeAiModelValues(value);

    return this.db
      .insert(aiModels)
      .values({ ...normalizedValue, id, providerId, updatedAt: new Date(), ...this.scopedValues() })
      .onConflictDoUpdate({
        set: normalizedValue,
        ...this.conflictTarget(),
      });
  };

  toggleModelEnabled = async (value: ToggleAiModelEnableParams) => {
    const now = new Date();
    const insertValues = {
      ...value,
      updatedAt: now,
      ...this.scopedValues(),
    } as typeof aiModels.$inferInsert;

    if (value.type) insertValues.type = normalizeAiModelType(value.type);

    const updateValues: Partial<typeof aiModels.$inferInsert> = {
      enabled: value.enabled,
      updatedAt: now,
    };

    if (value.type) updateValues.type = normalizeAiModelType(value.type);

    return this.db
      .insert(aiModels)
      .values(insertValues)
      .onConflictDoUpdate({
        set: updateValues,
        ...this.conflictTarget(),
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
      releasedAt: this.normalizeReleasedAt(model.releasedAt),
      type: normalizeAiModelType(model.type),
      updatedAt: new Date(),
      ...this.scopedValues(),
    }));

    return this.db
      .insert(aiModels)
      .values(records)
      .onConflictDoNothing({
        ...this.conflictDoNothingTarget(),
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
        ...this.scopedValues(),
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
        ...this.conflictTarget(),
      });
  };

  clearRemoteModels(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.providerId, providerId),
          eq(aiModels.source, AiModelSourceEnum.Remote),
          this.scopeWhere(),
        ),
      );
  }

  clearModelsByProvider(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.providerId, providerId), this.scopeWhere()));
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
          ...this.scopedValues(),
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
            ...this.conflictTarget(),
          });
      });

      await Promise.all(updates);
    });
  };
}
