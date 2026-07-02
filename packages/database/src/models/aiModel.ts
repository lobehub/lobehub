import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
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

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

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
        userId: this.userId,
      })
      .returning();

    return result;
  };

  delete = async (id: string, providerId: string) => {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.id, id),
          eq(aiModels.providerId, providerId),
          eq(aiModels.userId, this.userId),
        ),
      );
  };

  deleteAll = async () => {
    return this.db.delete(aiModels).where(eq(aiModels.userId, this.userId));
  };

  query = async () => {
    return this.db.query.aiModels.findMany({
      orderBy: [desc(aiModels.updatedAt)],
      where: eq(aiModels.userId, this.userId),
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
      .where(and(eq(aiModels.providerId, providerId), eq(aiModels.userId, this.userId)))
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
        pricing: aiModels.pricing,
        releasedAt: aiModels.releasedAt,
        settings: aiModels.settings,
        sort: aiModels.sort,
        source: aiModels.source,
        type: aiModels.type,
      })
      .from(aiModels)
      .where(and(eq(aiModels.userId, this.userId)));

    return data as EnabledAiModel[];
  };

  findById = async (id: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(eq(aiModels.id, id), eq(aiModels.userId, this.userId)),
    });
  };

  findByIdAndProvider = async (id: string, providerId: string) => {
    return this.db.query.aiModels.findFirst({
      where: and(
        eq(aiModels.id, id),
        eq(aiModels.providerId, providerId),
        eq(aiModels.userId, this.userId),
      ),
    });
  };

  update = async (id: string, providerId: string, value: Partial<AiModelSelectItem>) => {
    const normalizedValue = this.normalizeAiModelValues(value);

    return this.db
      .insert(aiModels)
      .values({ ...normalizedValue, id, providerId, updatedAt: new Date(), userId: this.userId })
      .onConflictDoUpdate({
        set: normalizedValue,
        target: [aiModels.id, aiModels.providerId, aiModels.userId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  toggleModelEnabled = async (value: ToggleAiModelEnableParams) => {
    const now = new Date();
    const insertValues = {
      ...value,
      updatedAt: now,
      userId: this.userId,
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
        target: [aiModels.id, aiModels.providerId, aiModels.userId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  batchUpdateAiModels = async (providerId: string, models: AiProviderModelListItem[]) => {
    // Early return if models array is empty to prevent database insertion error
    if (this.isEmptyArray(models)) {
      return [];
    }

    type BatchAiModelInput = Omit<AiProviderModelListItem, 'id'> &
      Partial<Pick<AiModelSelectItem, 'description' | 'organization' | 'sort'>>;

    const records = models.map(({ id, ...model }) => {
      const input = model as BatchAiModelInput;
      const record: typeof aiModels.$inferInsert = {
        id,
        providerId,
        updatedAt: new Date(),
        userId: this.userId,
      };

      // Only include fields that have meaningful values
      // Normalize releasedAt if present
      if (input.releasedAt !== undefined && input.releasedAt !== null) {
        record.releasedAt = this.normalizeReleasedAt(input.releasedAt);
      }

      // Only include abilities if it has at least one truthy capability
      const hasAnyAbility = input.abilities && Object.values(input.abilities).some((v) => v);
      if (hasAnyAbility) {
        record.abilities = input.abilities;
      } else if (input.abilities !== undefined) {
        // Mark as explicitly absent to distinguish from "not provided"
        record.abilities = null;
      }

      // Only include parameters if it has at least one key with non-null value
      const hasAnyParameter =
        input.parameters &&
        Object.keys(input.parameters).length > 0 &&
        Object.values(input.parameters).some((v) => v !== null && v !== undefined);
      if (hasAnyParameter) {
        record.parameters = input.parameters;
      } else if (input.parameters !== undefined) {
        // Mark as explicitly absent
        record.parameters = null;
      }

      // Include type if explicitly provided
      // When type is undefined, omit it to use schema default ('chat')
      // This means we can't distinguish "remote explicitly said chat" vs "remote didn't provide type"
      // Trade-off: remote models with type != 'chat' won't be updated back to 'chat' via batch update
      if (input.type !== undefined) {
        record.type = normalizeAiModelType(input.type);
      }

      // Include other provider-sourced fields if present
      if (input.contextWindowTokens !== undefined && input.contextWindowTokens !== null) {
        record.contextWindowTokens = input.contextWindowTokens;
      }
      if (input.pricing !== undefined && input.pricing !== null) {
        record.pricing = input.pricing;
      }

      // Include user-editable fields if present
      if (input.displayName !== undefined && input.displayName !== null) {
        record.displayName = input.displayName;
      }

      // Include other fields from model
      if (input.config !== undefined) record.config = input.config;
      if (input.enabled !== undefined) record.enabled = input.enabled;
      if (input.settings !== undefined) record.settings = input.settings;
      if (input.source !== undefined) record.source = input.source;

      // Include optional internal fields if present via wider caller payloads.
      if (input.description !== undefined) record.description = input.description;
      if (input.organization !== undefined) record.organization = input.organization;
      if (input.sort !== undefined) record.sort = input.sort;

      return record;
    });

    return this.db
      .insert(aiModels)
      .values(records)
      .onConflictDoUpdate({
        set: {
          // User-editable fields: keep existing DB value; only fill when NULL
          displayName: sql`COALESCE(ai_models.display_name, excluded.display_name)`,
          // Provider-sourced fields: allow remote data to update remote/custom/new models
          // For custom models, users can add a model ID before the provider supports it;
          // when the provider later adds that model, we should fill in pricing/abilities/etc.
          // Only builtin models are fully protected from remote updates.
          // Only update if excluded value is not NULL (meaning it was explicitly provided and valid)
          // Note: empty objects {} may come from schema defaults when field was omitted in payload
          abilities: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL)
              AND excluded.abilities IS NOT NULL
              AND excluded.abilities != '{}'::jsonb
            THEN excluded.abilities
            ELSE ai_models.abilities
          END`,
          contextWindowTokens: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL) AND excluded.context_window_tokens IS NOT NULL
            THEN excluded.context_window_tokens
            ELSE ai_models.context_window_tokens
          END`,
          description: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL) AND excluded.description IS NOT NULL
            THEN excluded.description
            ELSE ai_models.description
          END`,
          parameters: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL)
              AND excluded.parameters IS NOT NULL
              AND excluded.parameters != '{}'::jsonb
            THEN excluded.parameters
            ELSE ai_models.parameters
          END`,
          pricing: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL) AND excluded.pricing IS NOT NULL
            THEN excluded.pricing
            ELSE ai_models.pricing
          END`,
          releasedAt: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL) AND excluded.released_at IS NOT NULL
            THEN excluded.released_at
            ELSE ai_models.released_at
          END`,
          type: sql`CASE
            WHEN (ai_models.source = 'remote' OR ai_models.source = 'custom' OR ai_models.source IS NULL) AND excluded.type IS NOT NULL AND excluded.type != 'chat'
            THEN excluded.type
            WHEN ai_models.source = 'builtin' AND excluded.type IS NOT NULL
            THEN COALESCE(ai_models.type, excluded.type)
            ELSE ai_models.type
          END`,
          // source marks model origin (remote/custom/builtin); once set, never overwrite
          source: sql`COALESCE(ai_models.source, excluded.source)`,
          updatedAt: sql`excluded.updated_at`,
          // Note: enabled is intentionally omitted to preserve user toggle state
        },
        target: [aiModels.id, aiModels.userId, aiModels.providerId],
        targetWhere: isNull(aiModels.workspaceId),
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
        target: [aiModels.id, aiModels.userId, aiModels.providerId],
        targetWhere: isNull(aiModels.workspaceId),
      });
  };

  clearRemoteModels(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(
        and(
          eq(aiModels.providerId, providerId),
          eq(aiModels.source, AiModelSourceEnum.Remote),
          eq(aiModels.userId, this.userId),
        ),
      );
  }

  clearModelsByProvider(providerId: string) {
    return this.db
      .delete(aiModels)
      .where(and(eq(aiModels.providerId, providerId), eq(aiModels.userId, this.userId)));
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
            target: [aiModels.id, aiModels.userId, aiModels.providerId],
            targetWhere: isNull(aiModels.workspaceId),
          });
      });

      await Promise.all(updates);
    });
  };
}
