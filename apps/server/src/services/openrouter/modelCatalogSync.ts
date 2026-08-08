import { fetchOpenRouterModels } from '@lobechat/model-runtime';
import type { ChatModelCard } from '@lobechat/types';
import type { ModelAbilities } from 'model-bank';

import {
  type OpenRouterCatalogSyncRun,
  type OpenRouterCatalogSyncStatus,
  OpenRouterModelCatalogModel,
} from '@/database/models/openrouterModelCatalog';
import type { LobeChatDatabase } from '@/database/type';

const toAbilities = (model: ChatModelCard): ModelAbilities => {
  const abilities: ModelAbilities = {};
  if (model.files) abilities.files = true;
  if (model.functionCall) abilities.functionCall = true;
  if (model.imageOutput) abilities.imageOutput = true;
  if (model.reasoning) abilities.reasoning = true;
  if (model.search) abilities.search = true;
  if (model.video) abilities.video = true;
  if (model.vision) abilities.vision = true;
  return abilities;
};

export class OpenRouterModelCatalogSyncService {
  private catalog: OpenRouterModelCatalogModel;

  constructor(db: LobeChatDatabase) {
    this.catalog = new OpenRouterModelCatalogModel(db);
  }

  getStatus = async (): Promise<OpenRouterCatalogSyncStatus> => {
    return this.catalog.getSyncStatus();
  };

  listHistory = async (limit = 20): Promise<OpenRouterCatalogSyncRun[]> => {
    return this.catalog.listSyncRuns(limit);
  };

  /**
   * If the catalog is empty (first setup), pull OpenRouter once.
   * Returns whether a sync was attempted.
   */
  ensureInitialCatalog = async (): Promise<{
    synced: boolean;
    status: OpenRouterCatalogSyncStatus;
  }> => {
    const count = await this.catalog.count();
    if (count > 0) {
      return { status: await this.catalog.getSyncStatus(), synced: false };
    }
    const status = await this.sync('bootstrap');
    return { status, synced: true };
  };

  /**
   * Fetch the live OpenRouter catalog and persist it for the managed Aico provider.
   * @param triggeredBy `cron` | `bootstrap` | `manual:<userId>`
   */
  sync = async (triggeredBy: string): Promise<OpenRouterCatalogSyncStatus> => {
    try {
      const models = await fetchOpenRouterModels();

      return await this.catalog.replaceCatalog({
        models: models.map((model) => ({
          abilities: toAbilities(model),
          contextWindowTokens: model.contextWindowTokens,
          description: model.description,
          displayName: model.displayName,
          id: model.id,
          parameters: model.parameters,
          pricing: model.pricing,
          releasedAt: model.releasedAt,
          settings: model.settings,
          type: model.type ?? 'chat',
        })),
        triggeredBy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.catalog.markSyncError({ error: message, triggeredBy });
    }
  };
}
