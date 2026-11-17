// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { AgentLabelModel } from '../../../models/agentLabel';
import { ProjectModel } from '../../../models/project';
import { RecentModel } from '../../../models/recent';
import { agentLabelAssignments, agentLabels, agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { hydrateAgents } from '../../ftsSearch/elasticsearch/hydration';
import { FtsSearchRepo } from '../../ftsSearch/index';
import { PgLikeFtsSearchBackend } from '../../ftsSearch/pgLike';
import { ProjectRepository } from '../../project';
import { HomeRepository } from '../index';

/**
 * T-14329: a project's own coordinator (`agents.owner_project_id` set) is hidden
 * from every standalone agent listing, yet the row stays in the database and
 * every single-agent read the project relies on keeps resolving it.
 */
const db: LobeChatDatabase = await getTestDB();
const userId = 'owned-hidden-user';

let ownedId: string;
let projectId: string;
const PLAIN_ID = 'plain-agent';

const allIds = (items: { id: string }[]) => items.map(({ id }) => id);

const sidebarIds = async () => {
  const list = await new HomeRepository(db, userId).getSidebarAgentList();
  return allIds([
    ...list.pinned,
    ...list.ungrouped,
    ...list.groups.flatMap((g) => g.items),
    ...list.privatePinned,
    ...list.privateUngrouped,
    ...list.privateGroups.flatMap((g) => g.items),
  ]);
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });

  // The real create path: the project provisions its coordinator and owns it.
  const project = await new ProjectRepository(db, userId).create({
    identifier: 'HIDE',
    name: 'Apollo',
  });
  projectId = project.id;
  ownedId = project.coordinatorAgentId!;

  await db.insert(agents).values({
    description: 'An ordinary agent of mine',
    id: PLAIN_ID,
    title: 'Apollo Writer',
    userId,
  });
});

afterEach(async () => {
  await db.delete(users);
});

describe('project-owned coordinator is hidden from standalone agent lists', () => {
  it('is marked as owned by its project and the row stays in the database', async () => {
    const [row] = await db.select().from(agents).where(eq(agents.id, ownedId));

    expect(row).toBeDefined();
    expect(row.ownerProjectId).toBe(projectId);
    expect(row.isDeleted).toBeFalsy();
    expect(row.virtual).toBe(false);
  });

  it('sidebar / `/agents` list (home.getSidebarAgentList): owned hidden, ordinary shown', async () => {
    const ids = await sidebarIds();

    expect(ids).toContain(PLAIN_ID);
    expect(ids).not.toContain(ownedId);
  });

  it('sidebar search with external candidates drops the owned agent and asks the backend to', async () => {
    const ftsSearchCandidates = vi.fn().mockImplementation(({ entity }) =>
      Promise.resolve({
        candidates:
          entity === 'agents'
            ? [
                { id: ownedId, score: 10 },
                { id: PLAIN_ID, score: 5 },
              ]
            : [],
        total: 2,
      }),
    );
    const repo = new HomeRepository(db, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates,
    });

    const result = await repo.searchAgents('Apollo');

    expect(allIds(result)).toEqual([PLAIN_ID]);
    expect(ftsSearchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'agents',
        filters: { excludeProjectOwned: true, excludeVirtual: true },
      }),
    );
  });

  // BM25 (`@@@`) needs ParadeDB, so this path runs in the server-DB suite only.
  it.skipIf(process.env.TEST_SERVER_DB !== '1')(
    'sidebar search (BM25, no external candidates) leaves the owned agent out',
    async () => {
      const result = await new HomeRepository(db, userId).searchAgents('Apollo');

      expect(allIds(result)).toEqual([PLAIN_ID]);
    },
  );

  it('search candidates (pg_like) honour excludeProjectOwned', async () => {
    const repo = new FtsSearchRepo(db, userId, undefined, undefined, {
      backend: new PgLikeFtsSearchBackend(db, { userId }),
      ftsSearchCandidateEnabled: true,
    });
    const request = {
      entity: 'agents' as const,
      pagination: {},
      query: { fields: ['title', 'description'], text: 'Apollo' },
    };

    const filtered = await repo.ftsSearchCandidates({
      ...request,
      filters: { excludeProjectOwned: true, excludeVirtual: true },
    });
    expect(allIds(filtered.candidates)).toEqual([PLAIN_ID]);

    // Without the flag the backend still finds it: the filter hides, nothing is removed.
    const unfiltered = await repo.ftsSearchCandidates({ ...request, filters: {} });
    expect(allIds(unfiltered.candidates).sort()).toEqual([ownedId, PLAIN_ID].sort());
  });

  it('Cmd+K global search (postgres command menu) leaves the owned agent out', async () => {
    const repo = new FtsSearchRepo(db, userId, undefined, undefined, {
      backend: new PgLikeFtsSearchBackend(db, { userId }),
    });

    const results = await repo.search({ query: 'Apollo', type: 'agent' });

    expect(allIds(results)).toEqual([PLAIN_ID]);
  });

  it('Cmd+K global search (elasticsearch hydration) leaves the owned agent out', async () => {
    const rows = await hydrateAgents(
      db,
      [
        { id: ownedId, score: 10 },
        { id: PLAIN_ID, score: 5 },
      ] as any,
      { userId },
      10,
    );

    expect(allIds(rows)).toEqual([PLAIN_ID]);
  });

  it('queryAgents / countAgents (`lh agent list`, availableAgents) leave the owned agent out', async () => {
    const model = new AgentModel(db, userId);

    expect(allIds(await model.queryAgents())).toEqual([PLAIN_ID]);
    expect(allIds(await model.queryAgents({ keyword: 'Apollo' }))).toEqual([PLAIN_ID]);
    await expect(model.countAgents()).resolves.toBe(1);
  });

  it('label usage counts only the agents the list shows', async () => {
    const [label] = await db.insert(agentLabels).values({ name: 'Mine', userId }).returning();
    await db.insert(agentLabelAssignments).values([
      { agentId: ownedId, labelId: label.id, userId },
      { agentId: PLAIN_ID, labelId: label.id, userId },
    ]);

    const labels = await new AgentLabelModel(db, userId).query();

    expect(labels.find((l) => l.id === label.id)?.usageCount).toBe(1);
  });

  it('recents leave out topics of the owned agent', async () => {
    await db.insert(topics).values([
      { agentId: ownedId, id: 'tpc_owned', title: 'Owned chat', userId },
      { agentId: PLAIN_ID, id: 'tpc_plain', title: 'Plain chat', userId },
    ]);

    const recent = await new RecentModel(db, userId).queryRecent(10, ['topic']);

    expect(allIds(recent)).toEqual(['tpc_plain']);
  });
});

describe('access through the project keeps working', () => {
  it('a direct read of the owned agent (`/agent/:aid`, chat runtime) still resolves it', async () => {
    const config = await new AgentModel(db, userId).getAgentConfigById(ownedId);

    expect(config?.id).toBe(ownedId);
    expect(config?.title).toBe('Apollo Project Agent');
  });

  it('the project still lists the owned agent as its coordinator', async () => {
    const model = new ProjectModel(db, userId);

    expect((await model.findById(projectId))?.coordinatorAgentId).toBe(ownedId);
    const members = await model.listAgents(projectId);
    expect(members?.[0].agent.id).toBe(ownedId);
  });

  it('clearing the ownership (project deleted) brings the agent back into the lists', async () => {
    await new ProjectModel(db, userId).delete(projectId);

    const [row] = await db.select().from(agents).where(eq(agents.id, ownedId));
    expect(row.ownerProjectId).toBeNull();
    expect(await sidebarIds()).toContain(ownedId);
    expect(allIds(await new AgentModel(db, userId).queryAgents())).toContain(ownedId);
  });
});
