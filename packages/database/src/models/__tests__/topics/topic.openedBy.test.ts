import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, agents, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-opened-by-user';
const otherUserId = 'topic-opened-by-other';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

const openedBy = (topicId: string, extra: Record<string, unknown> = {}) => ({
  openedBy: { agentId: 'agent-a', at: '2026-11-17T00:00:00.000Z', topicId, ...extra },
});

describe('TopicModel - sub-topics (metadata.openedBy)', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(agents).values([
      { id: 'agent-a', userId },
      { id: 'agent-b', userId },
      { id: 'agent-other', userId: otherUserId },
    ]);
    await serverDB.insert(topics).values([
      { agentId: 'agent-a', id: 'parent', title: 'Parent', userId },
      {
        agentId: 'agent-a',
        id: 'child-same',
        metadata: openedBy('parent'),
        trigger: 'sub_topic',
        userId,
      },
      {
        agentId: 'agent-b',
        id: 'child-cross',
        metadata: openedBy('parent'),
        trigger: 'sub_topic',
        userId,
      },
      {
        agentId: 'agent-b',
        id: 'child-task',
        metadata: openedBy('parent'),
        trigger: 'task',
        userId,
      },
      {
        agentId: 'agent-b',
        id: 'grandchild',
        metadata: openedBy('child-cross', { agentId: 'agent-b' }),
        trigger: 'sub_topic',
        userId,
      },
      {
        agentId: 'agent-a',
        id: 'detached',
        metadata: openedBy('parent', { detachedAt: '2026-11-17T01:00:00.000Z' }),
        trigger: 'cli',
        userId,
      },
      {
        agentId: 'agent-a',
        id: 'archived-child',
        metadata: openedBy('parent'),
        status: 'completed',
        trigger: 'sub_topic',
        userId,
      },
      // Same jsonb shape but an unrelated trigger: never a sub-topic.
      { agentId: 'agent-a', id: 'chat-row', metadata: openedBy('parent'), userId },
      {
        agentId: 'agent-other',
        id: 'foreign',
        metadata: openedBy('parent'),
        trigger: 'sub_topic',
        userId: otherUserId,
      },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('lists the direct, live sub-topics of an opener, whatever their agent', async () => {
    const rows = await topicModel.listOpenedTopics({
      excludeStatuses: ['completed', 'archived'],
      openerTopicIds: ['parent'],
    });

    expect(rows.map((row) => row.id).sort()).toEqual(['child-cross', 'child-same', 'child-task']);
    const cross = rows.find((row) => row.id === 'child-cross')!;
    expect(cross.agentId).toBe('agent-b');
    expect(cross.openedBy.topicId).toBe('parent');
  });

  it('walks descendants when asked', async () => {
    const rows = await topicModel.listOpenedDescendants('parent', {
      excludeStatuses: ['completed', 'archived'],
    });

    expect(rows.map((row) => row.id).sort()).toEqual([
      'child-cross',
      'child-same',
      'child-task',
      'grandchild',
    ]);
  });

  it('walks a deep chain to its end for a cascade, unlike a sidebar listing', async () => {
    // parent → child-same → d1 → … → d6: seven generations below the parent.
    const chain = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    let previous = 'child-same';
    for (const id of chain) {
      await serverDB.insert(topics).values({
        agentId: 'agent-a',
        id,
        metadata: openedBy(previous),
        trigger: 'sub_topic',
        userId,
      });
      previous = id;
    }

    const listing = await topicModel.listOpenedTopics({
      includeDescendants: true,
      openerTopicIds: ['parent'],
    });
    expect(listing.map((row) => row.id)).not.toContain('d6');

    const descendants = await topicModel.listOpenedDescendants('parent', {
      excludeStatuses: ['completed', 'archived'],
    });
    expect(descendants.map((row) => row.id)).toEqual(expect.arrayContaining(chain));
    expect(descendants.map((row) => row.id)).not.toContain('parent');
  });

  it("reads one topic's latest top-level run status, null before its first run", async () => {
    expect(await topicModel.getLatestRunStatus('child-cross')).toBeNull();

    await serverDB.insert(agentOperations).values([
      {
        agentId: 'agent-b',
        createdAt: new Date('2026-11-17T00:00:00.000Z'),
        id: 'op-old',
        status: 'error',
        topicId: 'child-cross',
        userId,
      },
      {
        agentId: 'agent-b',
        createdAt: new Date('2026-11-17T01:00:00.000Z'),
        id: 'op-new',
        status: 'waiting_for_human',
        topicId: 'child-cross',
        userId,
      },
    ] as any);

    expect(await topicModel.getLatestRunStatus('child-cross')).toBe('waiting_for_human');
    // Another user's topic reads as having no run.
    expect(
      await new TopicModel(serverDB, otherUserId).getLatestRunStatus('child-cross'),
    ).toBeNull();
  });

  it('detaches sub-topics and turns a sub_topic trigger back into a normal topic', async () => {
    const changed = await topicModel.detachOpenedTopics(['child-cross', 'child-task']);
    expect(changed.map((row) => row.id).sort()).toEqual(['child-cross', 'child-task']);

    const [cross] = await serverDB.select().from(topics).where(eq(topics.id, 'child-cross'));
    expect(cross.trigger).toBeNull();
    expect((cross.metadata as any).openedBy.detachedAt).toEqual(expect.any(String));
    expect((cross.metadata as any).openedBy.topicId).toBe('parent');

    const [task] = await serverDB.select().from(topics).where(eq(topics.id, 'child-task'));
    expect(task.trigger).toBe('task');

    const rows = await topicModel.listOpenedTopics({ openerTopicIds: ['parent'] });
    expect(rows.map((row) => row.id).sort()).toEqual(['archived-child', 'child-same']);
  });

  it('hides sub-topics from the target agent list but falls back to the top level once the opener is gone', async () => {
    const excludeTriggers = ['task', 'sub_topic'];

    const before = await topicModel.query({ agentId: 'agent-b', excludeTriggers });
    expect(before.items.map((row: any) => row.id)).toEqual([]);

    await serverDB.delete(topics).where(eq(topics.id, 'parent'));

    const after = await topicModel.query({ agentId: 'agent-b', excludeTriggers });
    // The cross-agent child lost its opener; the grandchild's opener still exists.
    expect(after.items.map((row: any) => row.id)).toEqual(['child-cross']);
  });

  it('treats an opener in the recycle bin as gone', async () => {
    await topicModel.softDelete(['parent'], { deletedAt: new Date() });

    const result = await topicModel.query({
      agentId: 'agent-a',
      excludeTriggers: ['sub_topic'],
    });
    expect(result.items.map((row: any) => row.id).sort()).toEqual([
      'archived-child',
      'chat-row',
      'child-same',
      'detached',
    ]);
  });

  it('treats an archived opener as gone, so its sub-topic does not disappear', async () => {
    await serverDB.update(topics).set({ status: 'completed' }).where(eq(topics.id, 'parent'));

    const result = await topicModel.query({
      agentId: 'agent-b',
      excludeTriggers: ['task', 'sub_topic'],
    });
    expect(result.items.map((row: any) => row.id)).toEqual(['child-cross']);
  });

  it('reports a sub-topic that is itself one of the openers asked about', async () => {
    // The open conversation is pinned into the sidebar page, so it is both a list row
    // (an opener) and a sub-topic of another row.
    const rows = await topicModel.listOpenedTopics({
      includeDescendants: true,
      openerTopicIds: ['parent', 'child-cross'],
    });

    expect(rows.map((row) => row.id)).toContain('child-cross');
    expect(rows.map((row) => row.id)).toContain('grandchild');
    expect(rows.filter((row) => row.id === 'child-cross')).toHaveLength(1);
  });

  it("reports the latest top-level run's status, which server runs keep off topics.status", async () => {
    await serverDB.insert(agentOperations).values({
      agentId: 'agent-b',
      id: 'op-child-cross',
      status: 'running',
      topicId: 'child-cross',
      userId,
    } as any);

    const rows = await topicModel.listOpenedTopics({ openerTopicIds: ['parent'] });

    expect(rows.find((row) => row.id === 'child-cross')?.latestRunStatus).toBe('running');
    expect(rows.find((row) => row.id === 'child-same')?.latestRunStatus).toBeNull();
  });
});
