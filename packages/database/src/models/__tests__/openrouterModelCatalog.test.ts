import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  openrouterModelCatalog,
  openrouterModelSyncRuns,
  openrouterModelSyncState,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OpenRouterModelCatalogModel } from '../openrouterModelCatalog';

let db: LobeChatDatabase;
let catalog: OpenRouterModelCatalogModel;

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(openrouterModelCatalog);
  await db.delete(openrouterModelSyncState);
  await db.delete(openrouterModelSyncRuns);
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

  it('enables newest 4 chat models per family and every image/video generator', async () => {
    await catalog.replaceCatalog({
      models: [
        { displayName: 'GPT old', id: 'openai/gpt-old', releasedAt: '2024-01-01', type: 'chat' },
        { displayName: 'GPT 1', id: 'openai/gpt-1', releasedAt: '2024-06-01', type: 'chat' },
        { displayName: 'GPT 2', id: 'openai/gpt-2', releasedAt: '2025-01-01', type: 'chat' },
        { displayName: 'GPT 3', id: 'openai/gpt-3', releasedAt: '2025-06-01', type: 'chat' },
        { displayName: 'GPT 4', id: 'openai/gpt-4', releasedAt: '2025-12-01', type: 'chat' },
        {
          displayName: 'Claude',
          id: 'anthropic/claude-1',
          releasedAt: '2025-01-01',
          type: 'chat',
        },
        {
          displayName: 'Gemini',
          id: 'google/gemini-1',
          releasedAt: '2025-01-01',
          type: 'chat',
        },
        {
          displayName: 'DeepSeek',
          id: 'deepseek/deepseek-chat',
          releasedAt: '2026-01-01',
          type: 'chat',
        },
        {
          displayName: 'DALL-E',
          id: 'openai/dall-e',
          releasedAt: '2026-01-01',
          type: 'image',
        },
        {
          displayName: 'Veo 3',
          id: 'google/veo-3',
          releasedAt: '2026-01-01',
          type: 'video',
        },
      ],
      triggeredBy: 'manual:admin',
    });

    const rows = await catalog.listAsProviderModels();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['openai/gpt-4'].enabled).toBe(true);
    expect(byId['openai/gpt-3'].enabled).toBe(true);
    expect(byId['openai/gpt-2'].enabled).toBe(true);
    expect(byId['openai/gpt-1'].enabled).toBe(true);
    expect(byId['openai/gpt-old'].enabled).toBe(false);
    expect(byId['anthropic/claude-1'].enabled).toBe(true);
    expect(byId['google/gemini-1'].enabled).toBe(true);
    expect(byId['deepseek/deepseek-chat'].enabled).toBe(false);
    expect(byId['openai/dall-e'].enabled).toBe(true);
    expect(byId['google/veo-3'].enabled).toBe(true);

    const status = await catalog.getSyncStatus();
    expect(status).toMatchObject({
      lastStatus: 'success',
      lastTriggeredBy: 'manual:admin',
      // Input models + product Auto
      modelCount: 11,
    });
  });

  it('recomputes enabled flags on re-sync instead of preserving sticky true', async () => {
    await catalog.replaceCatalog({
      models: [
        { displayName: 'GPT-A', id: 'openai/gpt-a', releasedAt: '2025-01-01', type: 'chat' },
        { displayName: 'Claude', id: 'anthropic/claude-a', releasedAt: '2025-01-01', type: 'chat' },
      ],
      triggeredBy: 'manual:admin',
    });

    await catalog.replaceCatalog({
      models: [
        {
          displayName: 'GPT-A refreshed',
          id: 'openai/gpt-a',
          releasedAt: '2024-01-01',
          type: 'chat',
        },
        { displayName: 'GPT-B', id: 'openai/gpt-b', releasedAt: '2026-01-01', type: 'chat' },
        { displayName: 'Gemini', id: 'google/gemini-b', releasedAt: '2025-06-01', type: 'chat' },
      ],
      triggeredBy: 'cron',
    });

    const rows = await catalog.listAsProviderModels();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['openai/gpt-a'].enabled).toBe(true);
    expect(byId['openai/gpt-a'].displayName).toBe('GPT-A refreshed');
    expect(byId['openai/gpt-b'].enabled).toBe(true);
    expect(byId['google/gemini-b'].enabled).toBe(true);
    expect(byId['anthropic/claude-a']).toBeUndefined();

    const status = await catalog.getSyncStatus();
    expect(status).toMatchObject({
      lastStatus: 'success',
      lastTriggeredBy: 'cron',
      // Remaining models + product Auto
      modelCount: 4,
    });
    expect(status.lastSyncedAt).toBeTruthy();
  });

  it('records sync errors without clearing prior success metadata', async () => {
    await catalog.replaceCatalog({
      models: [{ displayName: 'X', id: 'openai/x', type: 'chat' }],
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
      // openai/x + product Auto
      modelCount: 2,
    });
    expect(afterError.lastSyncedAt).toBeTruthy();

    const history = await catalog.listSyncRuns(10);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      error: 'OpenRouter down',
      status: 'error',
      triggeredBy: 'manual:ops',
    });
    expect(history[1]).toMatchObject({
      addedModelIds: expect.arrayContaining(['openai/x']),
      status: 'success',
      triggeredBy: 'cron',
    });
  });

  it('records added and removed model ids across syncs', async () => {
    await catalog.replaceCatalog({
      models: [
        { displayName: 'A', id: 'openai/a', type: 'chat' },
        { displayName: 'B', id: 'openai/b', type: 'chat' },
      ],
      triggeredBy: 'manual:1',
    });

    await catalog.replaceCatalog({
      models: [
        { displayName: 'B', id: 'openai/b', type: 'chat' },
        { displayName: 'C', id: 'openai/c', type: 'chat' },
      ],
      triggeredBy: 'manual:2',
    });

    const [latest] = await catalog.listSyncRuns(1);
    expect(latest).toMatchObject({
      addedModelIds: ['openai/c'],
      removedModelIds: ['openai/a'],
      status: 'success',
      triggeredBy: 'manual:2',
    });
  });

  it('reseeds default enabled flags from existing rows', async () => {
    const now = new Date();
    await db.insert(openrouterModelCatalog).values([
      {
        enabled: true,
        id: 'deepseek/old',
        payload: {},
        releasedAt: '2026-01-01',
        syncedAt: now,
        type: 'chat',
      },
      {
        enabled: false,
        id: 'openai/new',
        payload: {},
        releasedAt: '2025-12-01',
        syncedAt: now,
        type: 'chat',
      },
    ]);

    await expect(catalog.reseedDefaultEnabledFlags()).resolves.toBe(2);

    const rows = await catalog.listAsProviderModels();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['openai/new'].enabled).toBe(true);
    expect(byId['deepseek/old'].enabled).toBe(false);
  });
});
