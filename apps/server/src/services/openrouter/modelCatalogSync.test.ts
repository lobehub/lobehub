import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { OpenRouterModelCatalogModel } from '@/database/models/openrouterModelCatalog';
import { openrouterModelCatalog, openrouterModelSyncState } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const fetchOpenRouterModels = vi.fn();

vi.mock('@lobechat/model-runtime', () => ({
  fetchOpenRouterModels: (...args: unknown[]) => fetchOpenRouterModels(...args),
}));

describe('OpenRouterModelCatalogSyncService', () => {
  let db: LobeChatDatabase;

  beforeEach(async () => {
    db = await getTestDB();
    await db.delete(openrouterModelCatalog);
    await db.delete(openrouterModelSyncState);
    fetchOpenRouterModels.mockReset();
  }, 30_000);

  it('writes catalog rows on successful fetch', async () => {
    fetchOpenRouterModels.mockResolvedValue([
      {
        displayName: 'Auto',
        functionCall: true,
        id: 'openrouter/auto',
        type: 'chat',
        vision: true,
      },
    ]);

    const { OpenRouterModelCatalogSyncService } = await import('./modelCatalogSync');
    const service = new OpenRouterModelCatalogSyncService(db);
    const status = await service.sync('manual:admin-1');

    expect(status).toMatchObject({
      lastStatus: 'success',
      lastTriggeredBy: 'manual:admin-1',
      modelCount: 1,
    });

    const catalog = new OpenRouterModelCatalogModel(db);
    const models = await catalog.listAsProviderModels();
    expect(models).toEqual([
      expect.objectContaining({
        abilities: expect.objectContaining({ functionCall: true, vision: true }),
        displayName: 'Auto',
        enabled: true,
        id: 'openrouter/auto',
      }),
    ]);
  });

  it('records failure status when OpenRouter fetch throws', async () => {
    fetchOpenRouterModels.mockRejectedValue(new Error('network down'));

    const { OpenRouterModelCatalogSyncService } = await import('./modelCatalogSync');
    const service = new OpenRouterModelCatalogSyncService(db);
    const status = await service.sync('cron');

    expect(status).toMatchObject({
      lastError: 'network down',
      lastStatus: 'error',
      lastTriggeredBy: 'cron',
    });
  });
});
