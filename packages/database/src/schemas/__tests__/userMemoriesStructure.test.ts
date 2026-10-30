// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  projects,
  userMemories,
  userMemoriesActivities,
  userMemoriesContextProjects,
  userMemoriesContexts,
  userMemoriesDossiers,
  userMemoriesEdges,
  userMemoriesEntities,
  userMemoriesEntityNames,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '..';

const serverDB = await getTestDB();
const userId = 'user-memories-structure-schema-user';

const createContext = async () => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({ lastAccessedAt: new Date(), memoryLayer: 'context', userId })
    .returning();
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({ title: 'CITIC enterprise deal', userId, userMemoryId: memory.id })
    .returning();
  return context;
};

const createProject = async () => {
  const [coordinator] = await serverDB
    .insert(agents)
    .values({ title: 'Coordinator', userId, virtual: true })
    .returning();
  const [project] = await serverDB
    .insert(projects)
    .values({ coordinatorAgentId: coordinator.id, name: 'LobeHub Cloud', userId })
    .returning();
  return project;
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const createMemory = async (memoryLayer: string) => {
  const [memory] = await serverDB
    .insert(userMemories)
    .values({ lastAccessedAt: new Date(), memoryLayer, userId })
    .returning();
  return memory;
};

describe('structured user memory schema', () => {
  it('relates any two memories through one edge per relation and drops it with either end', async () => {
    const citicTelecom = await createMemory('entity');
    const citicGroup = await createMemory('entity');
    const dossier = await createMemory('dossier');
    await serverDB.insert(userMemoriesEntities).values([
      { name: '中信国际电讯', type: 'customer', userId, userMemoryId: citicTelecom.id },
      { name: '中信集团', type: 'org', userId, userMemoryId: citicGroup.id },
    ]);

    await serverDB.insert(userMemoriesEdges).values([
      { relation: 'mentions', sourceMemoryId: dossier.id, targetMemoryId: citicTelecom.id, userId },
      {
        relation: 'distinct_from',
        sourceMemoryId: citicGroup.id,
        targetMemoryId: citicTelecom.id,
        userId,
      },
    ]);
    await expect(
      serverDB.insert(userMemoriesEdges).values({
        relation: 'mentions',
        sourceMemoryId: dossier.id,
        targetMemoryId: citicTelecom.id,
        userId,
      }),
    ).rejects.toThrow();

    const [mention] = await serverDB
      .select()
      .from(userMemoriesEdges)
      .where(eq(userMemoriesEdges.relation, 'mentions'));
    expect(mention).toMatchObject({ evidenceCount: 1, sourceMemoryId: dossier.id });

    await serverDB.delete(userMemories).where(eq(userMemories.id, citicTelecom.id));
    const remaining = await serverDB
      .select()
      .from(userMemoriesEdges)
      .where(eq(userMemoriesEdges.userId, userId));
    expect(remaining).toHaveLength(0);
    const entities = await serverDB
      .select()
      .from(userMemoriesEntities)
      .where(eq(userMemoriesEntities.userId, userId));
    expect(entities.map((entity) => entity.name)).toEqual(['中信集团']);
  });

  it('keeps activities as evidence when their dossier or context goes away', async () => {
    const context = await createContext();
    const [dossier] = await serverDB
      .insert(userMemoriesDossiers)
      .values({ contextId: context.id, title: 'Procurement first order', userId })
      .returning();
    const [activity] = await serverDB
      .insert(userMemoriesActivities)
      .values({
        dossierId: dossier.id,
        type: 'task',
        userId,
      })
      .returning();

    expect(dossier).toMatchObject({ activityCount: 0, status: 'active' });
    expect(activity).toMatchObject({ dossierId: dossier.id, injectable: true });

    await serverDB.delete(userMemoriesContexts).where(eq(userMemoriesContexts.id, context.id));
    const [orphanDossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, dossier.id));
    expect(orphanDossier.contextId).toBeNull();

    await serverDB.delete(userMemoriesDossiers).where(eq(userMemoriesDossiers.id, dossier.id));
    const [evidence] = await serverDB
      .select()
      .from(userMemoriesActivities)
      .where(eq(userMemoriesActivities.id, activity.id));
    expect(evidence.dossierId).toBeNull();
  });

  it('links a context to several projects once each and drops links with the project', async () => {
    const context = await createContext();
    const cloud = await createProject();
    const research = await createProject();

    await serverDB.insert(userMemoriesContextProjects).values([
      {
        contextId: context.id,
        evidenceCount: 3,
        isPrimary: true,
        projectId: cloud.id,
        source: 'topic',
        userId,
      },
      { contextId: context.id, projectId: research.id, source: 'inferred', userId },
    ]);

    await expect(
      serverDB
        .insert(userMemoriesContextProjects)
        .values({ contextId: context.id, projectId: cloud.id, source: 'user', userId }),
    ).rejects.toThrow();

    await serverDB.delete(projects).where(eq(projects.id, research.id));
    const links = await serverDB
      .select()
      .from(userMemoriesContextProjects)
      .where(eq(userMemoriesContextProjects.contextId, context.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ isPrimary: true, projectId: cloud.id });
  });

  it('allows one self entity per user and one row per normalized name', async () => {
    const [self] = await serverDB
      .insert(userMemoriesEntities)
      .values({ isSelf: true, name: 'Arvin Xu', type: 'self', userId })
      .returning();
    await expect(
      serverDB
        .insert(userMemoriesEntities)
        .values({ isSelf: true, name: 'Arvin', type: 'self', userId }),
    ).rejects.toThrow();

    const [person] = await serverDB
      .insert(userMemoriesEntities)
      .values({ name: 'Alex Shaw', type: 'person', userId })
      .returning();
    await serverDB.insert(userMemoriesEntityNames).values({
      entityId: person.id,
      kind: 'wrong',
      name: 'Wendong Zheng',
      normalized: 'wendong zheng',
      userId,
    });
    await expect(
      serverDB.insert(userMemoriesEntityNames).values({
        entityId: person.id,
        name: 'wendong zheng',
        normalized: 'wendong zheng',
        userId,
      }),
    ).rejects.toThrow();

    expect(self.type).toBe('self');
  });

  it('keeps facts and preferences when their entity is deleted', async () => {
    const [customer] = await serverDB
      .insert(userMemoriesEntities)
      .values({ name: '中信国际电讯', type: 'customer', userId })
      .returning();
    const [fact] = await serverDB
      .insert(userMemoriesIdentities)
      .values({ description: 'Listed as 1883.HK', entityId: customer.id, userId })
      .returning();
    const [preference] = await serverDB
      .insert(userMemoriesPreferences)
      .values({
        conclusionDirectives: 'Needs an on-premise sandboxed desktop client',
        evidenceSource: 'reported',
        holderEntityId: customer.id,
        userId,
      })
      .returning();

    expect(preference).toMatchObject({ evidenceCount: 1, evidenceSource: 'reported' });

    await serverDB.delete(userMemoriesEntities).where(eq(userMemoriesEntities.id, customer.id));
    const [keptFact] = await serverDB
      .select()
      .from(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.id, fact.id));
    const [keptPreference] = await serverDB
      .select()
      .from(userMemoriesPreferences)
      .where(eq(userMemoriesPreferences.id, preference.id));
    expect(keptFact.entityId).toBeNull();
    expect(keptPreference.holderEntityId).toBeNull();
  });
});
