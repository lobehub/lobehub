import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { openrouterModelCatalog, openrouterModelSyncState } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OpenRouterModelCatalogModel } from '../openrouterModelCatalog';

let db: LobeChatDatabase;
let catalog: OpenRouterModelCatalogModel;

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(openrouterModelCatalog);
  await db.delete(openrouterModelSyncState);
  catalog = new OpenRouterModelCatalogModel(db);
}, 30_000);

describe('OpenRouterModelCatalogModel', () => {
  it('starts with never-synced status', async () => {
    await expect(catalog.getSyncStatus()).resolves.toMatchObject({
      lastStatus: 'never',
      modelCount: 0,
    });
    await expect(catalog.count()).resolves.toBe(0);
  });

  it('replaces catalog and preserves enabled flags on re-sync', async () => {
    await catalog.replaceCatalog({
      models: [
        {
          abilities: { functionCall: true },
          displayName: 'GPT-4o',
          id: 'openai/gpt-4o',
          type: 'chat',
        },
        {
          displayName: 'Claude',
          id: 'anthropic/claude-sonnet-4',
          type: 'chat',
        },
      ],
      triggeredBy: 'manual:admin',
    });

    await db
      .update(openrouterModelCatalog)
      .set({ enabled: false })
      .where(eq(openrouterModelCatalog.id, 'openai/gpt-4o'));

    await catalog.replaceCatalog({
      models: [
        {
          displayName: 'GPT-4o refreshed',
          id: 'openai/gpt-4o',
          type: 'chat',
        },
        {
          displayName: 'New model',
          id: 'google/gemini-2.5-pro',
          type: 'chat',
        },
      ],
      triggeredBy: 'cron',
    });

    const rows = await catalog.listAsProviderModels();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['openai/gpt-4o'].enabled).toBe(false);
    expect(byId['openai/gpt-4o'].displayName).toBe('GPT-4o refreshed');
    expect(byId['google/gemini-2.5-pro'].enabled).toBe(true);
    expect(byId['anthropic/claude-sonnet-4']).toBeUndefined();

    const status = await catalog.getSyncStatus();
    expect(status).toMatchObject({
      lastStatus: 'success',
      lastTriggeredBy: 'cron',
      modelCount: 2,
    });
    expect(status.lastSyncedAt).toBeTruthy();
  });

  it('records sync errors without clearing prior success metadata', async () => {
    await catalog.replaceCatalog({
      models: [{ displayName: 'X', id: 'x/y', type: 'chat' }],
      triggeredBy: 'cron',
    });

    const afterError = await catalog.markSyncError({
      error: 'OpenRouter down',
      triggeredBy: 'manual:ops',
    });

    expect(afterError).toMatchObject({
      lastError: 'OpenRouter down',
      lastStatus: 'error',
      lastTriggeredBy: 'manual:ops',
      modelCount: 1,
    });
    expect(afterError.lastSyncedAt).toBeTruthy();
  });
});
