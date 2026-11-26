// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backfillAgentGatewayModeOptOut,
  type BackfillPool,
} from '../../../../../scripts/backfillAgentGatewayModeOptOutCore';
import { getTestDB } from '../../core/getTestDB';
import { agents, users, userSettings, workspaces } from '../../schemas';

const db = await getTestDB();
const optedOutUser = 'gateway-backfill-off';
const optedInUser = 'gateway-backfill-on';
const workspaceId = 'gateway-backfill-workspace';
const createdBefore = new Date('2026-12-01T00:00:00Z');
const before = new Date('2026-11-01T00:00:00Z');
const after = new Date('2026-12-02T00:00:00Z');

/** The backfill speaks raw SQL; hand it the test database's underlying client. */
const pool: BackfillPool = {
  connect: async () => ({
    query: async (text, params) => (db as any).$client.query(text, params),
  }),
};

const chatConfigOf = async (id: string) => {
  const [row] = await db
    .select({ chatConfig: agents.chatConfig, updatedAt: agents.updatedAt })
    .from(agents)
    .where(eq(agents.id, id));
  return row;
};

beforeEach(async () => {
  await db.insert(users).values([{ id: optedOutUser }, { id: optedInUser }]);
  await db.insert(userSettings).values([
    {
      defaultAgent: { config: { chatConfig: { disableGatewayMode: true } } },
      id: optedOutUser,
    },
    {
      defaultAgent: { config: { chatConfig: { disableGatewayMode: false } } },
      id: optedInUser,
    },
  ]);
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Gateway backfill workspace',
    primaryOwnerId: optedOutUser,
    slug: workspaceId,
  });
  await db.insert(agents).values([
    // Inherited the global opt-out: must keep it.
    { chatConfig: null, createdAt: before, id: 'inherits-null', userId: optedOutUser },
    {
      chatConfig: { searchMode: 'auto' } as any,
      createdAt: before,
      id: 'inherits-object',
      userId: optedOutUser,
    },
    // Its own value already won over the global one: untouched.
    {
      chatConfig: { disableGatewayMode: false } as any,
      createdAt: before,
      id: 'explicit-on',
      userId: optedOutUser,
    },
    // Shared with every workspace member: a personal preference must not leak in.
    { createdAt: before, id: 'workspace-agent', userId: optedOutUser, workspaceId },
    // Created after the release: gets the new default (on).
    { createdAt: after, id: 'created-after', userId: optedOutUser },
    // Global value was "on": nothing to preserve.
    { createdAt: before, id: 'opted-in-agent', userId: optedInUser },
  ]);
});

afterEach(async () => {
  await db.delete(agents);
  await db.delete(workspaces);
  await db.delete(userSettings);
  await db.delete(users);
});

describe('backfillAgentGatewayModeOptOut', () => {
  it('copies the global opt-out onto personal agents that inherited it', async () => {
    const { updatedAt: updatedAtBefore } = await chatConfigOf('inherits-object');

    const progress = await backfillAgentGatewayModeOptOut(pool, {
      apply: true,
      batchSize: 10,
      createdBefore,
    });

    expect(progress).toEqual({ agents: 2, users: 1 });
    expect((await chatConfigOf('inherits-null')).chatConfig).toEqual({ disableGatewayMode: true });
    const inheritsObject = await chatConfigOf('inherits-object');
    expect(inheritsObject.chatConfig).toEqual({ disableGatewayMode: true, searchMode: 'auto' });
    // Behavior-neutral write: must not reorder agent lists.
    expect(inheritsObject.updatedAt).toEqual(updatedAtBefore);

    expect((await chatConfigOf('explicit-on')).chatConfig).toEqual({ disableGatewayMode: false });
    expect((await chatConfigOf('workspace-agent')).chatConfig).toBeNull();
    expect((await chatConfigOf('created-after')).chatConfig).toBeNull();
    expect((await chatConfigOf('opted-in-agent')).chatConfig).toBeNull();
  });

  it('writes nothing in a dry run and converges on re-run', async () => {
    const dryRun = await backfillAgentGatewayModeOptOut(pool, {
      apply: false,
      batchSize: 10,
      createdBefore,
    });
    expect(dryRun).toEqual({ agents: 2, users: 1 });
    expect((await chatConfigOf('inherits-null')).chatConfig).toBeNull();

    await backfillAgentGatewayModeOptOut(pool, { apply: true, batchSize: 10, createdBefore });
    const rerun = await backfillAgentGatewayModeOptOut(pool, {
      apply: true,
      batchSize: 10,
      createdBefore,
    });
    expect(rerun).toEqual({ agents: 0, users: 1 });
  });
});
