import type * as DrizzleMigrator from 'drizzle-orm/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  marketAccounts,
  marketAgentEvents,
  marketAgents,
  marketAgentVersions,
} from '../../../../packages/database/src/schemas/market';
import type { MarketHttpError } from '../http/errors';
import { MarketAccountModel } from '../models/account';
import type { MarketDatabase } from '../types';
import { AgentService } from './agents';

interface DatabaseTestUtils {
  getTestDB: () => Promise<MarketDatabase>;
}

vi.mock('@/config/db', () => ({
  serverDBEnv: {},
}));

// PGlite rejects a prepared statement containing multiple migration commands; split those Drizzle statements in tests only.
vi.mock('drizzle-orm/migrator', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleMigrator>();

  return {
    ...actual,
    readMigrationFiles: (config: Parameters<typeof actual.readMigrationFiles>[0]) =>
      actual.readMigrationFiles(config).map((migration) => ({
        ...migration,
        sql: migration.sql.flatMap((statement) => {
          if (
            !statement.includes('DROP CONSTRAINT IF EXISTS') ||
            !statement.includes('ADD CONSTRAINT')
          ) {
            return statement;
          }

          return statement
            .split(/;\s*\n/)
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => `${part};`);
        }),
      })),
  };
});

const loadDatabaseTestUtils = async (): Promise<DatabaseTestUtils> =>
  await import('@lobechat/database/test-utils' as string);

const { getTestDB } = await loadDatabaseTestUtils();

describe('AgentService', async () => {
  const db: MarketDatabase = await getTestDB();
  const accountModel = new MarketAccountModel(db);
  const service = new AgentService(db);

  const createAccount = async (userId: string, name: string) =>
    accountModel.upsertFromTrustedPayload({
      clientId: 'trusted-client',
      email: `${userId}@example.com`,
      name,
      nonce: `${userId}-nonce`,
      timestamp: Date.now(),
      userId,
    });

  beforeEach(async () => {
    await db.delete(marketAgentEvents);
    await db.delete(marketAgentVersions);
    await db.delete(marketAgents);
    await db.delete(marketAccounts);
  });

  it('creates, versions, publishes, lists, and returns agent detail', async () => {
    const account = await createAccount('owner-one', 'Owner One');

    const agent = await service.createAgent(account.id, {
      identifier: 'agent-one',
      name: 'Agent One',
    });
    const version = await service.createAgentVersion(account.id, {
      avatar: 'https://example.com/avatar.png',
      category: 'productivity',
      config: { model: 'test-model' },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      description: 'Agent One description',
      editorData: { prompt: 'Help the user' },
      hasStreaming: true,
      identifier: 'agent-one',
      summary: 'Agent One summary',
      tags: ['utility', 'test'],
    });
    await service.modifyAgent(account.id, {
      identifier: 'agent-one',
      status: 'published',
    });

    const list = await service.listAgents({
      page: 1,
      pageSize: 20,
      status: 'published',
      visibility: 'public',
    });
    const detail = await service.getAgentDetail('agent-one');

    expect(agent).toMatchObject({
      identifier: 'agent-one',
      name: 'Agent One',
      ownerId: account.id,
    });
    expect(version).toMatchObject({
      agentId: agent.id,
      description: 'Agent One description',
      isLatest: true,
      name: 'Agent One',
      version: '1.0.0',
      versionNumber: 1,
    });
    expect(list).toMatchObject({
      currentPage: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      identifier: 'agent-one',
      name: 'Agent One',
    });
    expect(detail).toMatchObject({
      avatar: 'https://example.com/avatar.png',
      config: { model: 'test-model' },
      identifier: 'agent-one',
      name: 'Agent One',
      ownerId: account.id,
      status: 'published',
      versionNumber: 1,
    });

    expect(await service.listIdentifiers()).toEqual([
      {
        id: 'agent-one',
        lastModified: expect.any(String),
      },
    ]);
  });

  it('hides private and unpublished agents from the default public list', async () => {
    const account = await createAccount('privacy-owner', 'Privacy Owner');

    await service.createAgent(account.id, {
      identifier: 'public-agent',
      name: 'Public Agent',
    });
    await service.createAgentVersion(account.id, {
      identifier: 'public-agent',
    });
    await service.modifyAgent(account.id, {
      identifier: 'public-agent',
      status: 'published',
    });
    await service.createAgent(account.id, {
      identifier: 'private-agent',
      name: 'Private Agent',
      status: 'published',
      visibility: 'private',
    });
    await service.createAgentVersion(account.id, {
      identifier: 'private-agent',
    });
    await service.createAgent(account.id, {
      identifier: 'draft-agent',
      name: 'Draft Agent',
      visibility: 'public',
    });
    await service.createAgentVersion(account.id, {
      identifier: 'draft-agent',
    });

    const list = await service.listAgents();
    const publicUnpublishedList = await service.listAgents({
      page: 1,
      pageSize: 20,
      status: 'unpublished',
    });
    const publicPrivateList = await service.listAgents({
      page: 1,
      pageSize: 20,
      visibility: 'private',
    });
    const ownerPrivateList = await service.listAgents({
      ownerId: account.id,
      page: 1,
      pageSize: 20,
      visibility: 'private',
    });

    expect(list.items.map((item) => item.identifier)).toEqual(['public-agent']);
    expect(list).toMatchObject({
      totalCount: 1,
      totalPages: 1,
    });
    expect(publicUnpublishedList.items.map((item) => item.identifier)).toEqual(['public-agent']);
    expect(publicPrivateList).toMatchObject({
      items: [],
      totalCount: 0,
      totalPages: 0,
    });
    expect(ownerPrivateList.items.map((item) => item.identifier)).toEqual(['private-agent']);
    expect(ownerPrivateList).toMatchObject({
      totalCount: 1,
      totalPages: 1,
    });
    await expect(service.getAgentDetail('draft-agent')).rejects.toMatchObject({
      code: 'agent_not_found',
      status: 404,
    } satisfies Partial<MarketHttpError>);
    await expect(
      service.getAgentDetail('draft-agent', { includePrivateForAccountId: account.id }),
    ).resolves.toMatchObject({
      identifier: 'draft-agent',
      status: 'unpublished',
    });
    await expect(service.increaseInstallCount('draft-agent')).rejects.toMatchObject({
      code: 'agent_not_found',
      status: 404,
    } satisfies Partial<MarketHttpError>);
    await expect(
      service.createEvent(null, { event: 'click', identifier: 'draft-agent' }),
    ).rejects.toMatchObject({
      code: 'agent_not_found',
      status: 404,
    } satisfies Partial<MarketHttpError>);
  });

  it('forks an agent from the source version and hides private forks from non-owners', async () => {
    const sourceOwner = await createAccount('source-owner', 'Source Owner');
    const second = await createAccount('second-owner', 'Second Owner');

    const sourceAgent = await service.createAgent(sourceOwner.id, {
      identifier: 'source-agent',
      name: 'Source Agent',
    });
    await service.createAgentVersion(sourceOwner.id, {
      avatar: 'https://example.com/source.png',
      config: { model: 'source-model' },
      description: 'Source description',
      identifier: 'source-agent',
      name: 'Source Version Name',
      summary: 'Source summary',
      tags: ['source'],
    });
    await service.modifyAgent(sourceOwner.id, {
      identifier: 'source-agent',
      status: 'published',
    });

    const fork = await service.forkAgent(second.id, 'source-agent', {
      identifier: 'forked-agent',
      visibility: 'private',
    });
    await service.forkAgent(second.id, 'source-agent', {
      identifier: 'draft-public-fork',
      visibility: 'public',
    });
    await service.forkAgent(second.id, 'source-agent', {
      identifier: 'published-public-fork',
      status: 'published',
      visibility: 'public',
    });
    const privateDetail = await service.getAgentDetail('forked-agent', {
      includePrivateForAccountId: second.id,
    });
    const publicForks = await service.listForks('source-agent');
    const ownerForks = await service.listForks('source-agent', {
      includePrivateForAccountId: second.id,
    });
    const ownerForkSource = await service.getForkSource('forked-agent', {
      includePrivateForAccountId: second.id,
    });

    expect(fork.agent).toMatchObject({
      forkedFromAgentId: sourceAgent.id,
      identifier: 'forked-agent',
      name: 'Source Version Name',
      ownerId: second.id,
    });
    expect(fork.source).toMatchObject({
      agentId: sourceAgent.id,
      identifier: 'source-agent',
      versionNumber: 1,
    });
    expect(privateDetail).toMatchObject({
      config: { model: 'source-model' },
      identifier: 'forked-agent',
      name: 'Source Version Name',
      visibility: 'private',
    });
    expect(publicForks).toMatchObject({
      forks: [expect.objectContaining({ identifier: 'published-public-fork' })],
      totalCount: 1,
    });
    expect(ownerForks).toMatchObject({
      totalCount: 3,
    });
    expect(ownerForks.forks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'forked-agent', ownerId: second.id }),
        expect.objectContaining({ identifier: 'draft-public-fork', ownerId: second.id }),
        expect.objectContaining({ identifier: 'published-public-fork', ownerId: second.id }),
      ]),
    );
    expect(ownerForkSource.source).toMatchObject({
      identifier: 'source-agent',
      ownerId: sourceOwner.id,
    });
    await expect(service.getAgentDetail('forked-agent')).rejects.toMatchObject({
      code: 'agent_not_found',
      status: 404,
    } satisfies Partial<MarketHttpError>);
    await expect(service.getForkSource('forked-agent')).rejects.toMatchObject({
      code: 'agent_not_found',
      status: 404,
    } satisfies Partial<MarketHttpError>);
  });

  it('does not count agents without current versions when list items omit them', async () => {
    const account = await createAccount('versionless-owner', 'Versionless Owner');

    await service.createAgent(account.id, {
      identifier: 'versioned-agent',
      name: 'Versioned Agent',
      status: 'published',
    });
    await service.createAgentVersion(account.id, {
      identifier: 'versioned-agent',
    });
    await service.createAgent(account.id, {
      identifier: 'versionless-agent',
      name: 'Versionless Agent',
      status: 'published',
    });

    const list = await service.listAgents({ page: 1, pageSize: 20 });

    expect(list.items.map((item) => item.identifier)).toEqual(['versioned-agent']);
    expect(list).toMatchObject({
      totalCount: 1,
      totalPages: 1,
    });
  });

  it('rejects mutations by accounts that do not own the agent', async () => {
    const owner = await createAccount('agent-owner', 'Agent Owner');
    const intruder = await createAccount('intruder', 'Intruder');

    await service.createAgent(owner.id, {
      identifier: 'owned-agent',
      name: 'Owned Agent',
    });

    await expect(
      service.modifyAgent(intruder.id, {
        identifier: 'owned-agent',
        name: 'Intruder Rename',
      }),
    ).rejects.toMatchObject({
      code: 'agent_forbidden',
      status: 403,
    } satisfies Partial<MarketHttpError>);
  });

  it('ignores moderation fields from user-controlled agent mutations', async () => {
    const account = await createAccount('moderation-owner', 'Moderation Owner');

    await service.createAgent(account.id, {
      identifier: 'moderation-agent',
      isFeatured: true,
      name: 'Moderation Agent',
    });
    await service.createAgentVersion(account.id, {
      identifier: 'moderation-agent',
    });
    await service.modifyAgent(account.id, {
      identifier: 'moderation-agent',
      isFeatured: true,
      isOfficial: true,
      status: 'published',
    });

    const detail = await service.getAgentDetail('moderation-agent');

    expect(detail).toMatchObject({
      identifier: 'moderation-agent',
      isFeatured: false,
      isOfficial: false,
    });
  });
});
