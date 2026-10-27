// @vitest-environment node
import { createWakeIdentityLoader } from '../identity';

const makeDb = (agent: unknown, user: unknown) => ({
  query: {
    agents: { findFirst: vi.fn(async () => agent) },
    users: { findFirst: vi.fn(async () => user) },
  },
});

describe('createWakeIdentityLoader', () => {
  it('reads the agent’s name and title and what the owner is called', async () => {
    const db = makeDb(
      { name: 'Arvin Agent', title: 'Release helper' },
      { fullName: 'Arvin Zhang', username: 'arvin' },
    );

    await expect(
      createWakeIdentityLoader({ agentId: 'a', db: db as never, userId: 'u' })(),
    ).resolves.toEqual({
      agentName: 'Arvin Agent',
      agentTitle: 'Release helper',
      ownerNames: ['Arvin Zhang', 'arvin'],
    });
  });

  it('lists a name once and skips blanks', async () => {
    const db = makeDb({ name: ' ', title: null }, { fullName: 'arvin', username: 'arvin' });

    await expect(
      createWakeIdentityLoader({ agentId: 'a', db: db as never, userId: 'u' })(),
    ).resolves.toEqual({
      agentName: undefined,
      agentTitle: undefined,
      ownerNames: ['arvin'],
    });
  });

  it('reads the database once for a burst of messages', async () => {
    const db = makeDb({ name: 'A' }, { username: 'u' });
    const load = createWakeIdentityLoader({ agentId: 'a', db: db as never, userId: 'u' });

    await load();
    await load();

    expect(db.query.agents.findFirst).toHaveBeenCalledTimes(1);
    expect(db.query.users.findFirst).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failed read', async () => {
    const db = makeDb({ name: 'A' }, { username: 'u' });
    db.query.agents.findFirst.mockRejectedValueOnce(new Error('db down'));
    const load = createWakeIdentityLoader({ agentId: 'a', db: db as never, userId: 'u' });

    await expect(load()).rejects.toThrow('db down');
    await expect(load()).resolves.toMatchObject({ agentName: 'A' });
  });
});
