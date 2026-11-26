// @vitest-environment node
import { createWakeIdentityLoader, MAX_AGENT_DESCRIPTION_LENGTH } from '../identity';

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
      agentDescription: undefined,
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

  it('reads what the agent is for: its description, else the opening of its system role', async () => {
    const described = makeDb(
      { description: ' Triages bug reports ', name: 'A', systemRole: 'You are a long prompt' },
      { username: 'u' },
    );
    await expect(
      createWakeIdentityLoader({ agentId: 'a', db: described as never, userId: 'u' })(),
    ).resolves.toMatchObject({ agentDescription: 'Triages bug reports' });

    const role = `You triage bug reports. ${'x'.repeat(MAX_AGENT_DESCRIPTION_LENGTH)}`;
    const roleOnly = makeDb({ description: null, name: 'A', systemRole: role }, { username: 'u' });
    const { agentDescription } = await createWakeIdentityLoader({
      agentId: 'a',
      db: roleOnly as never,
      userId: 'u',
    })();
    expect(agentDescription).toBe(`${role.slice(0, MAX_AGENT_DESCRIPTION_LENGTH)}…`);
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
