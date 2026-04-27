// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel } from '@/database/models/agentDocuments';

import { agentDocumentRouter } from '../../agentDocument';
import { cleanupTestUser, createTestAgent, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn().mockImplementation(() => ({
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
    storeResources: vi.fn().mockResolvedValue({}),
  })),
}));

describe('AgentDocument VFS Router Integration Tests', () => {
  let agentDocumentModel: AgentDocumentModel;
  let agentId: string;
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    agentId = await createTestAgent(serverDB, userId);
    agentDocumentModel = new AgentDocumentModel(serverDB, userId);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('lists ordinary root documents and synthetic mounts through listDocumentsByPath', async () => {
    await agentDocumentModel.create(agentId, 'SOUL.md', '# Soul');

    const caller = agentDocumentRouter.createCaller(createTestContext(userId));
    const nodes = await caller.listDocumentsByPath({ agentId, path: './' });

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mount: expect.objectContaining({ driver: 'agent-documents' }),
          name: 'SOUL.md',
          path: './SOUL.md',
          type: 'file',
        }),
        expect.objectContaining({
          mount: expect.objectContaining({ driver: 'synthetic' }),
          name: 'lobe',
          path: './lobe',
          type: 'directory',
        }),
      ]),
    );
  });

  it('stats and reads ordinary documents through VFS path APIs', async () => {
    await agentDocumentModel.create(agentId, 'SOUL.md', '# Soul');

    const caller = agentDocumentRouter.createCaller(createTestContext(userId));
    const stat = await caller.statDocumentByPath({ agentId, path: './SOUL.md' });
    const read = await caller.readDocumentByPath({ agentId, path: './SOUL.md' });

    expect(stat).toEqual(
      expect.objectContaining({
        mount: expect.objectContaining({ driver: 'agent-documents' }),
        path: './SOUL.md',
        type: 'file',
      }),
    );
    expect(read).toEqual(
      expect.objectContaining({
        content: '# Soul',
        path: './SOUL.md',
      }),
    );
  });

  it('stats mounted agent skills through unified ./lobe paths', async () => {
    const caller = agentDocumentRouter.createCaller(createTestContext(userId));

    await caller.writeDocumentByPath({
      agentId,
      content: '# Router Skill',
      path: './lobe/skills/agent/skills/router-skill/SKILL.md',
    });

    const stat = await caller.statDocumentByPath({
      agentId,
      path: './lobe/skills/agent/skills/router-skill/SKILL.md',
    });

    expect(stat).toEqual(
      expect.objectContaining({
        mount: expect.objectContaining({ driver: 'skills', namespace: 'agent' }),
        path: './lobe/skills/agent/skills/router-skill/SKILL.md',
        type: 'file',
      }),
    );

    const read = await caller.readDocumentByPath({
      agentId,
      path: './lobe/skills/agent/skills/router-skill/SKILL.md',
    });

    if (!read) {
      throw new Error('Expected readDocumentByPath to return the router skill file content');
    }

    expect(read.content).toContain('# Router Skill');
  });
});
