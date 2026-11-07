// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'slug-test-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.updateSlug', () => {
  it('should rename an ordinary agent', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agent-rename', slug: 'old-slug', title: 'Agent', userId });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-rename', 'new-slug')).toEqual({ success: true });

    const row = await serverDB.query.agents.findFirst({
      columns: { slug: true },
      where: (t, { eq }) => eq(t.id, 'agent-rename'),
    });
    expect(row?.slug).toBe('new-slug');
  });

  it('should normalize case and surrounding whitespace', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agent-case', slug: 'agent-case', title: 'Agent', userId });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-case', '  Mixed-Case  ')).toEqual({ success: true });

    const row = await serverDB.query.agents.findFirst({
      columns: { slug: true },
      where: (t, { eq }) => eq(t.id, 'agent-case'),
    });
    expect(row?.slug).toBe('mixed-case');
  });

  it('should reject a malformed slug', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agent-invalid', slug: 'agent-invalid', title: 'Agent', userId });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-invalid', 'not a slug!')).toEqual({
      reason: 'invalid',
      success: false,
    });
  });

  it('should reject renaming TO a builtin slug', async () => {
    await serverDB
      .insert(agents)
      .values({ id: 'agent-to-builtin', slug: 'agent-to-builtin', title: 'Agent', userId });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-to-builtin', BUILTIN_AGENT_SLUGS.inbox)).toEqual({
      reason: 'reserved',
      success: false,
    });
  });

  // Regression: a builtin agent IS its slug — `getBuiltinAgent` resolves it by
  // that string. Renaming one away used to succeed, which minted a second empty
  // inbox on the next lookup and stranded the original's history.
  it('should reject renaming a builtin agent AWAY from its slug', async () => {
    await serverDB.insert(agents).values({
      id: 'agent-inbox',
      slug: BUILTIN_AGENT_SLUGS.inbox,
      title: 'Lobe AI',
      userId,
    });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-inbox', 'my-inbox')).toEqual({
      reason: 'builtin',
      success: false,
    });

    const row = await serverDB.query.agents.findFirst({
      columns: { slug: true },
      where: (t, { eq }) => eq(t.id, 'agent-inbox'),
    });
    expect(row?.slug).toBe(BUILTIN_AGENT_SLUGS.inbox);
  });

  // Saving the identity form without touching the slug must not trip the
  // builtin guard — the no-op check runs first.
  it('should accept a builtin agent re-submitting its own slug', async () => {
    await serverDB.insert(agents).values({
      id: 'agent-inbox-noop',
      slug: BUILTIN_AGENT_SLUGS.inbox,
      title: 'Lobe AI',
      userId,
    });

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-inbox-noop', BUILTIN_AGENT_SLUGS.inbox)).toEqual({
      success: true,
    });
  });

  it('should reject a slug already taken in the same scope', async () => {
    await serverDB.insert(agents).values([
      { id: 'agent-a', slug: 'agent-a', title: 'A', userId },
      { id: 'agent-b', slug: 'agent-b', title: 'B', userId },
    ]);

    const model = new AgentModel(serverDB, userId);
    expect(await model.updateSlug('agent-a', 'agent-b')).toEqual({
      reason: 'taken',
      success: false,
    });
  });

  it('should throw for an agent the caller does not own', async () => {
    await serverDB.insert(users).values([{ id: 'other-user' }]);
    await serverDB
      .insert(agents)
      .values({ id: 'agent-foreign', slug: 'agent-foreign', title: 'X', userId: 'other-user' });

    const model = new AgentModel(serverDB, userId);
    await expect(model.updateSlug('agent-foreign', 'stolen')).rejects.toThrow();
  });
});
