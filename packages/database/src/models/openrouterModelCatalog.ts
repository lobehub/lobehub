import { computeDefaultEnabledOpenRouterModelIds } from '@lobechat/business-const';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { AiProviderModelListItem, ModelAbilities, Pricing } from 'model-bank';
import { AiModelSourceEnum, normalizeAiModelType } from 'model-bank';

import {
  type NewOpenrouterModelCatalog,
  openrouterModelCatalog,
  openrouterModelSyncRuns,
  openrouterModelSyncState,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export type OpenRouterCatalogSyncStatus = {
  lastError: string | null;
  lastStatus: string;
  lastSyncedAt: string | null;
  lastTriggeredBy: string | null;
  modelCount: number;
};

export type OpenRouterCatalogSyncRun = {
  addedModelIds: string[];
  error: string | null;
  id: string;
  modelCount: number;
  removedModelIds: string[];
  status: string;
  syncedAt: string;
  triggeredBy: string | null;
};

export type OpenRouterCatalogModelInput = {
  abilities?: ModelAbilities;
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  enabled?: boolean;
  id: string;
  pricing?: Pricing;
  releasedAt?: string;
  settings?: AiProviderModelListItem['settings'];
  type?: string;
  /** Extra fields preserved in payload JSON. */
  [key: string]: unknown;
};

const SYNC_STATE_ID = 'default';

export class OpenRouterModelCatalogModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  getSyncStatus = async (): Promise<OpenRouterCatalogSyncStatus> => {
    const row = await this.db.query.openrouterModelSyncState.findFirst({
      where: eq(openrouterModelSyncState.id, SYNC_STATE_ID),
    });

    return {
      lastError: row?.lastError ?? null,
      lastStatus: row?.lastStatus ?? 'never',
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      lastTriggeredBy: row?.lastTriggeredBy ?? null,
      modelCount: row?.modelCount ?? 0,
    };
  };

  listSyncRuns = async (limit = 20): Promise<OpenRouterCatalogSyncRun[]> => {
    const rows = await this.db
      .select()
      .from(openrouterModelSyncRuns)
      .orderBy(desc(openrouterModelSyncRuns.syncedAt))
      .limit(Math.min(100, Math.max(1, limit)));

    return rows.map((row) => ({
      addedModelIds: (row.addedModelIds as string[]) ?? [],
      error: row.error ?? null,
      id: row.id,
      modelCount: row.modelCount,
      removedModelIds: (row.removedModelIds as string[]) ?? [],
      status: row.status,
      syncedAt: row.syncedAt.toISOString(),
      triggeredBy: row.triggeredBy ?? null,
    }));
  };

  count = async (): Promise<number> => {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(openrouterModelCatalog);
    return row?.count ?? 0;
  };

  listAsProviderModels = async (): Promise<AiProviderModelListItem[]> => {
    const rows = await this.db.select().from(openrouterModelCatalog);
    const defaultEnabled = computeDefaultEnabledOpenRouterModelIds(
      rows.map((row) => ({
        id: row.id,
        releasedAt: row.releasedAt,
        type: row.type,
      })),
    );

    return rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        ...payload,
        abilities: (row.abilities ?? {}) as ModelAbilities,
        contextWindowTokens: row.contextWindowTokens ?? undefined,
        description: row.description ?? undefined,
        displayName: row.displayName ?? undefined,
        // Platform default: latest 4 chat models per openai/anthropic/google.
        // Per-user overrides live in `ai_models` and win at merge time.
        enabled: defaultEnabled.has(row.id),
        id: row.id,
        pricing: (row.pricing ?? undefined) as Pricing | undefined,
        releasedAt: row.releasedAt ?? undefined,
        settings: (row.settings ?? undefined) as AiProviderModelListItem['settings'],
        source: AiModelSourceEnum.Remote,
        type: normalizeAiModelType(row.type),
      } as AiProviderModelListItem;
    });
  };

  /**
   * Recompute and persist `enabled` flags from the current catalog rows
   * (latest 4 chat models per openai / anthropic / google).
   */
  reseedDefaultEnabledFlags = async (): Promise<number> => {
    const rows = await this.db
      .select({
        id: openrouterModelCatalog.id,
        releasedAt: openrouterModelCatalog.releasedAt,
        type: openrouterModelCatalog.type,
      })
      .from(openrouterModelCatalog);

    if (rows.length === 0) return 0;

    const defaultEnabled = computeDefaultEnabledOpenRouterModelIds(rows);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const enabledIds = [...defaultEnabled];
      const disabledIds = rows.map((r) => r.id).filter((id) => !defaultEnabled.has(id));

      if (enabledIds.length > 0) {
        await tx
          .update(openrouterModelCatalog)
          .set({ enabled: true, updatedAt: now })
          .where(inArray(openrouterModelCatalog.id, enabledIds));
      }
      if (disabledIds.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < disabledIds.length; i += CHUNK) {
          const chunk = disabledIds.slice(i, i + CHUNK);
          await tx
            .update(openrouterModelCatalog)
            .set({ enabled: false, updatedAt: now })
            .where(inArray(openrouterModelCatalog.id, chunk));
        }
      }
    });

    return defaultEnabled.size;
  };

  /**
   * Replace the catalog with a fresh OpenRouter snapshot.
   * Recomputes platform default `enabled` (latest 4 chat / openai|anthropic|google) on every sync.
   * Records added/removed model ids in sync-run history.
   */
  replaceCatalog = async (params: {
    models: OpenRouterCatalogModelInput[];
    triggeredBy: string;
  }): Promise<
    OpenRouterCatalogSyncStatus & { addedModelIds: string[]; removedModelIds: string[] }
  > => {
    const now = new Date();
    const incomingIds = params.models.map((m) => m.id);

    const existing = await this.db
      .select({ id: openrouterModelCatalog.id })
      .from(openrouterModelCatalog);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingSet = new Set(incomingIds);

    const addedModelIds = incomingIds.filter((id) => !existingIds.has(id));
    const removedModelIds = existing.filter((r) => !incomingSet.has(r.id)).map((r) => r.id);

    const defaultEnabled = computeDefaultEnabledOpenRouterModelIds(
      params.models.map((model) => ({
        id: model.id,
        releasedAt: model.releasedAt,
        type: model.type,
      })),
    );

    const rows: NewOpenrouterModelCatalog[] = params.models.map((model) => {
      const {
        abilities,
        contextWindowTokens,
        description,
        displayName,
        enabled: _ignoredEnabled,
        id,
        pricing,
        releasedAt,
        settings,
        type,
        ...rest
      } = model;

      return {
        abilities: abilities ?? {},
        contextWindowTokens: contextWindowTokens ?? null,
        description: description ?? null,
        displayName: displayName ?? null,
        enabled: defaultEnabled.has(id),
        id,
        payload: {
          ...rest,
          abilities,
          contextWindowTokens,
          description,
          displayName,
          id,
          pricing,
          releasedAt,
          settings,
          type,
        },
        pricing: pricing ?? null,
        releasedAt: releasedAt ? releasedAt.slice(0, 10) : null,
        settings: settings ?? {},
        syncedAt: now,
        type: normalizeAiModelType(type) || 'chat',
      };
    });

    await this.db.transaction(async (tx) => {
      if (incomingIds.length > 0) {
        if (removedModelIds.length > 0) {
          await tx
            .delete(openrouterModelCatalog)
            .where(inArray(openrouterModelCatalog.id, removedModelIds));
        }

        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          await tx
            .insert(openrouterModelCatalog)
            .values(chunk)
            .onConflictDoUpdate({
              set: {
                abilities: sql`excluded.abilities`,
                contextWindowTokens: sql`excluded.context_window_tokens`,
                description: sql`excluded.description`,
                displayName: sql`excluded.display_name`,
                enabled: sql`excluded.enabled`,
                payload: sql`excluded.payload`,
                pricing: sql`excluded.pricing`,
                releasedAt: sql`excluded.released_at`,
                settings: sql`excluded.settings`,
                syncedAt: sql`excluded.synced_at`,
                type: sql`excluded.type`,
                updatedAt: now,
              },
              target: openrouterModelCatalog.id,
            });
        }
      } else {
        await tx.delete(openrouterModelCatalog);
      }

      await tx
        .insert(openrouterModelSyncState)
        .values({
          id: SYNC_STATE_ID,
          lastError: null,
          lastStatus: 'success',
          lastSyncedAt: now,
          lastTriggeredBy: params.triggeredBy,
          modelCount: rows.length,
        })
        .onConflictDoUpdate({
          set: {
            lastError: null,
            lastStatus: 'success',
            lastSyncedAt: now,
            lastTriggeredBy: params.triggeredBy,
            modelCount: rows.length,
            updatedAt: now,
          },
          target: openrouterModelSyncState.id,
        });

      await tx.insert(openrouterModelSyncRuns).values({
        addedModelIds,
        error: null,
        modelCount: rows.length,
        removedModelIds,
        status: 'success',
        syncedAt: now,
        triggeredBy: params.triggeredBy,
      });
    });

    const status = await this.getSyncStatus();
    return { ...status, addedModelIds, removedModelIds };
  };

  markSyncError = async (params: {
    error: string;
    triggeredBy: string;
  }): Promise<OpenRouterCatalogSyncStatus> => {
    const now = new Date();
    const current = await this.getSyncStatus();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(openrouterModelSyncState)
        .values({
          id: SYNC_STATE_ID,
          lastError: params.error.slice(0, 2000),
          lastStatus: 'error',
          lastSyncedAt: current.lastSyncedAt ? new Date(current.lastSyncedAt) : null,
          lastTriggeredBy: params.triggeredBy,
          modelCount: current.modelCount,
        })
        .onConflictDoUpdate({
          set: {
            lastError: params.error.slice(0, 2000),
            lastStatus: 'error',
            lastTriggeredBy: params.triggeredBy,
            updatedAt: now,
          },
          target: openrouterModelSyncState.id,
        });

      await tx.insert(openrouterModelSyncRuns).values({
        addedModelIds: [],
        error: params.error.slice(0, 2000),
        modelCount: current.modelCount,
        removedModelIds: [],
        status: 'error',
        syncedAt: now,
        triggeredBy: params.triggeredBy,
      });
    });

    return this.getSyncStatus();
  };
}
