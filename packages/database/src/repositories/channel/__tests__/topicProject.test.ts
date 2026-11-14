import { describe, expect, it, vi } from 'vitest';

import { resolveTopic } from '../topic';

const executionConfig = { model: 'gpt-5', provider: 'openai', runtime: 'native' } as never;

const channel = (projectId: string | null) =>
  ({ id: 'channel-1', projectId, workspaceId: 'ws-1' }) as never;

const member = { agentId: 'agt-1', id: 'member-1' } as never;
const job = { id: 'job-1', requesterMemberId: 'member-1', threadId: null } as never;

/** A completed run this Channel/topic pair can continue from. */
const reusableRun = (topicProjectId: string | null) => {
  const now = new Date();
  return {
    job: {
      acceptedAt: now,
      claimedAt: now,
      draft: 'The reply',
      executionConfig,
      id: 'job-0',
      isolatedAt: false,
      manifest: { cutoffSequence: 1 },
      publicationRevoked: false,
      writerHeld: false,
    },
    operation: { status: 'done' },
    topic: {
      agentId: 'agt-1',
      id: 'tpc-1',
      isDeleted: false,
      projectId: topicProjectId,
      updatedAt: now,
      userId: 'user-1',
      workspaceId: 'ws-1',
    },
  };
};

const chain = (rows: unknown[]) => {
  const result = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    leftJoin: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    where: vi.fn(),
  });
  for (const method of ['from', 'leftJoin', 'limit', 'orderBy', 'where'] as const)
    result[method].mockReturnValue(result);
  return result;
};

/** A transaction stub covering the reads/writes `resolveTopic` makes. */
const transaction = (rows: unknown[], returned: Record<string, unknown[]>) => {
  const insertValues = vi.fn(() => ({
    returning: vi.fn(async () => returned.insert ?? []),
  }));
  const updateReturning = vi.fn(async () => returned.update ?? []);
  const updateSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturning })) }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    insert,
    insertValues,
    select: vi.fn(() => chain(rows)),
    tx: { insert, select: vi.fn(() => chain(rows)), update } as never,
    update,
    updateReturning,
    updateSet,
  };
};

describe('resolveTopic — the topic inherits the Channel’s project', () => {
  it('creates the topic inside the Channel’s project', async () => {
    const store = transaction([], {
      insert: [{ id: 'tpc-new', projectId: 'proj-1' }],
    });

    const topic = await resolveTopic(
      store.tx,
      channel('proj-1'),
      job,
      member,
      'user-1',
      2,
      executionConfig,
    );

    expect(store.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', userId: 'user-1', workspaceId: 'ws-1' }),
    );
    expect(topic).toMatchObject({ id: 'tpc-new', projectId: 'proj-1' });
  });

  it('adopts the project for a reused topic that has none', async () => {
    const store = transaction([reusableRun(null)], {
      update: [{ id: 'tpc-1', projectId: 'proj-1' }],
    });

    const topic = await resolveTopic(
      store.tx,
      channel('proj-1'),
      job,
      member,
      'user-1',
      2,
      executionConfig,
    );

    expect(store.updateSet).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(topic).toMatchObject({ id: 'tpc-1', projectId: 'proj-1' });
  });

  it('never re-homes a topic already bound to another project', async () => {
    const store = transaction([reusableRun('proj-9')], {});

    const topic = await resolveTopic(
      store.tx,
      channel('proj-1'),
      job,
      member,
      'user-1',
      2,
      executionConfig,
    );

    expect(store.update).not.toHaveBeenCalled();
    expect(topic).toMatchObject({ id: 'tpc-1', projectId: 'proj-9' });
  });

  it('leaves a workspace Channel’s topic without a project', async () => {
    const store = transaction([reusableRun(null)], {});

    const topic = await resolveTopic(
      store.tx,
      channel(null),
      job,
      member,
      'user-1',
      2,
      executionConfig,
    );

    expect(store.update).not.toHaveBeenCalled();
    expect(topic).toMatchObject({ id: 'tpc-1', projectId: null });
  });
});
