import { fetchOpenRouterModels } from '@lobechat/model-runtime';
import type { ChatModelCard } from '@lobechat/types';
import type { ModelAbilities } from 'model-bank';

import {
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

  /**
   * Fetch the live OpenRouter catalog and persist it for the managed Aico provider.
   * @param triggeredBy `cron` or `manual:<userId>`
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
          // Image-tab `:image` clones need parameters restored from payload.
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
