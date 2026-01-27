// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserPersonaModel } from '@/database/models/userMemory/persona';

import { UserPersonaService } from '../service';

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    agentLayerExtractor: {
      apiKey: 'test-key',
      baseURL: 'https://example.com',
      language: 'English',
      layers: { context: 'gpt-mock' },
      model: 'gpt-mock',
      provider: 'openai',
    },
    agentPersonaWriter: {
      apiKey: 'test-key',
      baseURL: 'https://example.com',
      language: 'English',
      model: 'gpt-mock',
      provider: 'openai',
    },
  }),
}));

const structuredResult = {
  diff: '- updated',
  memoryIds: ['mem-1'],
  persona: '# Persona',
  reasoning: 'reason',
  sourceIds: ['src-1'],
  summary: 'summary',
};

const toolCall = vi.fn().mockResolvedValue(structuredResult);

vi.mock('@lobechat/memory-user-memory', () => ({
  UserPersonaExtractor: vi.fn().mockImplementation(() => ({
    toolCall,
  })),
}));

vi.mock('@lobechat/model-runtime', () => ({
  ModelRuntime: {
    initializeWithProvider: vi.fn().mockResolvedValue({}),
  },
}));

let db: LobeChatDatabase;
const userId = 'user-persona-service';

beforeEach(async () => {
  toolCall.mockClear();
  db = await getTestDB();

  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('UserPersonaService', () => {
  it('composes and persists persona via agent', async () => {
    const service = new UserPersonaService(db);
    const result = await service.composeWriting({
      personaNotes: '- note',
      recentEvents: '- event',
      retrievedMemories: '- mem',
      userId,
      username: 'User',
    });

    expect(toolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'English',
        username: 'User',
      }),
    );
    expect(result.document.persona).toBe('# Persona');

    const model = new UserPersonaModel(db, userId);
    const latest = await model.getLatestPersonaDocument();
    expect(latest?.version).toBe(1);
  });

  it('passes existing persona baseline on subsequent runs', async () => {
    const service = new UserPersonaService(db);
    await service.composeWriting({ userId, username: 'User' });
    await service.composeWriting({ userId, username: 'User' });

    expect(toolCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        existingPersona: '# Persona',
      }),
    );
  });
});
