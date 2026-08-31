// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  chatGroups,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  topics,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocuments,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FTS_SEARCH_DOCUMENT_FIXTURES } from './__tests__/fixtures';
import { FtsSearchDocumentBuilder } from './builder';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from './schema';

const userId = 'search-document-user';
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');
const capturedAt = new Date('2026-01-03T00:00:00.000Z');

const db: LobeChatDatabase = await getTestDB();
const builder = new FtsSearchDocumentBuilder(db);

const seedFixtures = async () => {
  await db.insert(users).values({ id: userId });

  await db.insert(agents).values([
    {
      createdAt,
      description: 'Agent description',
      id: 'agent-1',
      slug: 'agent-slug',
      systemRole: 'Agent system role',
      tags: ['coding', 'search'],
      title: 'Agent title',
      updatedAt,
      userId,
      virtual: false,
      visibility: 'public',
    },
    {
      createdAt,
      id: 'agent-2',
      title: 'Second agent',
      updatedAt,
      userId,
    },
  ]);

  await db.insert(chatGroups).values({
    content: 'Group content',
    createdAt,
    description: 'Group description',
    id: 'chat-group-1',
    title: 'Group title',
    updatedAt,
    userId,
    visibility: 'private',
  });

  await db.insert(topics).values({
    agentId: 'agent-1',
    content: 'Topic content',
    createdAt,
    description: 'Topic description',
    groupId: 'chat-group-1',
    id: 'topic-1',
    status: 'active',
    title: 'Topic title',
    updatedAt,
    userId,
  });

  await db.insert(messages).values({
    agentId: 'agent-1',
    content: 'Message content',
    createdAt,
    groupId: 'chat-group-1',
    id: 'message-1',
    role: 'user',
    summary: 'Message summary',
    topicId: 'topic-1',
    updatedAt,
    userId,
  });

  await db.insert(knowledgeBases).values([
    {
      createdAt,
      description: 'Knowledge base description',
      id: 'knowledge-base-file',
      isPublic: true,
      name: 'Knowledge base',
      type: 'file',
      updatedAt,
      userId,
      visibility: 'private',
    },
    {
      createdAt,
      id: 'knowledge-base-inline',
      name: 'Inline knowledge base',
      updatedAt,
      userId,
    },
  ]);

  await db.insert(files).values({
    createdAt,
    fileType: 'text/plain',
    id: 'file-1',
    name: 'fixture.txt',
    size: 128,
    updatedAt,
    url: 'https://example.com/fixture.txt',
    userId,
    visibility: 'public',
  });

  await db.insert(knowledgeBaseFiles).values({
    fileId: 'file-1',
    knowledgeBaseId: 'knowledge-base-file',
    userId,
  });

  await db.insert(documents).values({
    content: 'Document content',
    createdAt,
    description: 'Document description',
    fileId: 'file-1',
    fileType: 'text/plain',
    id: 'document-1',
    knowledgeBaseId: 'knowledge-base-inline',
    slug: 'document-slug',
    source: 'https://example.com/fixture.txt',
    sourceType: 'file',
    title: 'Document title',
    totalCharCount: 16,
    totalLineCount: 1,
    updatedAt,
    userId,
    visibility: 'public',
  });

  await db.insert(userMemories).values({
    capturedAt,
    createdAt,
    details: 'Parent details',
    id: 'memory-1',
    lastAccessedAt: capturedAt,
    memoryCategory: 'work',
    memoryLayer: 'episodic',
    status: 'active',
    summary: 'Parent summary',
    tags: ['parent'],
    title: 'Parent title',
    updatedAt,
    userId,
  });

  await db.insert(userMemoriesContexts).values({
    capturedAt,
    createdAt,
    currentStatus: 'Context status',
    description: 'Context description',
    id: 'memory-context-1',
    tags: ['context'],
    title: 'Context title',
    type: 'project',
    updatedAt,
    userId,
    userMemoryIds: ['memory-1'],
  });

  await db.insert(userMemoriesPreferences).values({
    capturedAt,
    conclusionDirectives: 'Preference directives',
    createdAt,
    id: 'memory-preference-1',
    suggestions: 'Preference suggestions',
    tags: ['preference'],
    type: 'communication',
    updatedAt,
    userId,
    userMemoryId: 'memory-1',
  });

  await db.insert(userMemoriesActivities).values({
    capturedAt,
    createdAt,
    feedback: 'Activity feedback',
    id: 'memory-activity-1',
    narrative: 'Activity narrative',
    notes: 'Activity notes',
    startsAt: capturedAt,
    status: 'pending',
    tags: ['activity'],
    type: 'task',
    updatedAt,
    userId,
    userMemoryId: 'memory-1',
  });

  await db.insert(userMemoriesIdentities).values({
    capturedAt,
    createdAt,
    description: 'Identity description',
    episodicDate: capturedAt,
    id: 'memory-identity-1',
    relationship: 'colleague',
    role: 'Engineer',
    tags: ['identity'],
    type: 'person',
    updatedAt,
    userId,
    userMemoryId: 'memory-1',
  });

  await db.insert(userMemoriesExperiences).values({
    action: 'Experience action',
    capturedAt,
    createdAt,
    id: 'memory-experience-1',
    keyLearning: 'Experience learning',
    possibleOutcome: 'Experience outcome',
    reasoning: 'Experience reasoning',
    situation: 'Experience situation',
    tags: ['experience'],
    type: 'decision',
    updatedAt,
    userId,
    userMemoryId: 'memory-1',
  });

  await db.insert(userPersonaDocuments).values({
    capturedAt,
    createdAt,
    id: 'persona-document-1',
    persona: 'Persona body',
    profile: 'default',
    tagline: 'Persona tagline',
    updatedAt,
    userId,
    version: 2,
  });
};

beforeAll(async () => {
  await db.delete(users);
  await seedFixtures();
});

afterAll(async () => {
  await db.delete(users);
});

describe('FtsSearchDocumentBuilder', () => {
  it('builds all 14 canonical fixtures with stable IDs and deterministic payloads', async () => {
    for (const entity of FTS_SEARCH_DOCUMENT_ENTITIES) {
      const fixture = FTS_SEARCH_DOCUMENT_FIXTURES[entity];
      const first = await builder.buildByIds(entity, [fixture.id]);
      const second = await builder.buildByIds(entity, [fixture.id]);

      expect(first).toEqual([{ entity, id: fixture.id, source: fixture }]);
      expect(second).toEqual(first);
    }
  });

  it('uses a stable ID cursor for deterministic batches', async () => {
    const first = await builder.buildBatch('agents', { limit: 1 });
    const second = await builder.buildBatch('agents', { afterId: first[0].id, limit: 1 });

    expect(first.map(({ id }) => id)).toEqual(['agent-1']);
    expect(second.map(({ id }) => id)).toEqual(['agent-2']);
  });

  it('uses inclusive lower and exclusive upper bounds for parallel range batches', async () => {
    await expect(
      builder.buildRangeBatch('messages', {
        beforeId: 'message-2',
        fromId: 'message-1',
        limit: 10,
      }),
    ).resolves.toMatchObject([{ id: 'message-1' }]);
    await expect(
      builder.buildRangeBatch('messages', { afterId: 'message-1', limit: 10 }),
    ).resolves.toEqual([]);
    await expect(
      builder.buildRangeBatch('messages', { beforeId: 'message-1', limit: 10 }),
    ).resolves.toEqual([]);
  });

  it('normalizes duplicate IDs and omits missing source records', async () => {
    const result = await builder.buildByIds('agents', ['missing', 'agent-1', 'agent-1']);

    expect(result.map(({ id }) => id)).toEqual(['agent-1']);
  });

  it('rejects invalid batch limits before querying PostgreSQL', async () => {
    await expect(builder.buildBatch('agents', { limit: 0 })).rejects.toThrow(
      'FTS search document batch limit must be a positive integer',
    );
    await expect(
      builder.buildRangeBatch('messages', {
        afterId: 'message-1',
        fromId: 'message-1',
        limit: 1,
      }),
    ).rejects.toThrow('cannot use afterId and fromId together');
  });

  it('lists file and file-backed document keys affected by KB relation changes', async () => {
    await expect(
      builder.resolveAffectedKeys({
        fileIds: ['file-1', 'file-1'],
        relation: 'knowledgeBaseFiles',
      }),
    ).resolves.toEqual([
      { entity: 'files', id: 'file-1' },
      { entity: 'documents', id: 'document-1' },
    ]);
  });

  it('lists every denormalized child affected by a memory change', async () => {
    await expect(
      builder.resolveAffectedKeys({ memoryIds: ['memory-1'], relation: 'userMemoryReferences' }),
    ).resolves.toEqual([
      { entity: 'userMemories', id: 'memory-1' },
      { entity: 'memoryContexts', id: 'memory-context-1' },
      { entity: 'memoryPreferences', id: 'memory-preference-1' },
      { entity: 'memoryActivities', id: 'memory-activity-1' },
      { entity: 'memoryIdentities', id: 'memory-identity-1' },
      { entity: 'memoryExperiences', id: 'memory-experience-1' },
    ]);
  });
});
