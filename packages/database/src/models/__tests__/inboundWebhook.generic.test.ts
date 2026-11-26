// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users } from '../../schemas';
import type { CreateInboundWebhook } from '../inboundWebhook';
import { InboundWebhookModel } from '../inboundWebhook';

const db = await getTestDB();
const userId = 'inbound-generic-user';
const agentId = 'inbound-generic-agent';
const topicId = 'inbound-generic-topic';
const gateKeeper = {
  encrypt: async (value: string) => `cipher:${Buffer.from(value).toString('base64')}`,
  decrypt: async (value: string) => ({
    plaintext: Buffer.from(value.slice(7), 'base64').toString(),
  }),
};
const model = new InboundWebhookModel(db, userId, undefined, gateKeeper);

const generic = (patch: Partial<CreateInboundWebhook> = {}): CreateInboundWebhook => ({
  agentId,
  config: { autoApprove: false, topicMode: 'new' },
  kind: 'generic',
  secret: 'token-1',
  status: 'active',
  verification: { scheme: 'bearer_token' },
  ...patch,
});
const mcp = (): CreateInboundWebhook => ({
  agentId,
  config: { arguments: {}, eventName: 'issue.created' },
  kind: 'mcp_events',
  secret: 'whsec_test',
  status: 'active',
  topicId,
  verification: { scheme: 'standard_webhooks' },
});

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ agentId, id: topicId, userId });
});

afterEach(async () => {
  await db.delete(users);
});

describe('InboundWebhookModel generic rows', () => {
  it('stores a generic row with no topic and narrows it by kind', async () => {
    const row = await model.create(generic());
    expect(row.kind).toBe('generic');
    expect(row.topicId).toBeNull();
    if (row.kind !== 'generic') throw new Error('not narrowed');
    expect(row.config).toEqual({ autoApprove: false, topicMode: 'new' });
    expect(row.verification).toEqual({ scheme: 'bearer_token' });
  });

  it('rejects a config or verification of the other kind', async () => {
    await expect(
      model.create(generic({ config: { arguments: {}, eventName: 'x' } as never })),
    ).rejects.toThrow();
    await expect(
      model.create(generic({ verification: { scheme: 'standard_webhooks' } })),
    ).rejects.toThrow();
  });

  it('applies a config replacement only to rows of the kind that accepts it', async () => {
    const row = await model.create(generic());
    const other = await model.create(mcp());
    const updated = await model.update(row.id, {
      config: { autoApprove: true, topicMode: 'reuse' },
      instructions: 'Triage it',
      name: 'Alerts',
    });
    expect(updated).toMatchObject({
      config: { autoApprove: true, topicMode: 'reuse' },
      instructions: 'Triage it',
      name: 'Alerts',
    });
    expect(
      await model.update(other.id, { config: { autoApprove: true, topicMode: 'reuse' } }),
    ).toBeUndefined();
    expect((await model.findById(other.id))?.config).toEqual({
      arguments: {},
      eventName: 'issue.created',
    });
  });

  it('never merges an MCP state patch into a generic row', async () => {
    const row = await model.create(generic());
    expect(await model.mergeState(row.id, { truncated: true })).toBeUndefined();
    expect(
      await model.updateIfStatus(row.id, { lastError: null }, ['active'], { cursor: 'c' }),
    ).toBeUndefined();
    expect((await model.findById(row.id))?.state).toEqual({});
  });

  it('lists a paused row and keeps it out of delivery only through its status', async () => {
    const row = await model.create(generic());
    await model.update(row.id, { status: 'paused' });
    expect((await model.query({ agentId })).map((r) => r.status)).toEqual(['paused']);
    expect((await InboundWebhookModel.findForDelivery(db, row.id, gateKeeper))?.row.status).toBe(
      'paused',
    );
  });

  it('rotates the secret, encrypted, so only the new one is returned', async () => {
    const row = await model.create(generic());
    await model.rotateSecret(row.id, 'token-2');
    expect(await model.getSecret(row.id)).toBe('token-2');
    expect((await InboundWebhookModel.findForDelivery(db, row.id, gateKeeper))?.secret).toBe(
      'token-2',
    );
  });

  it('does not rotate a row that is being deleted', async () => {
    const row = await model.create(generic());
    await model.update(row.id, { status: 'deleting' });
    expect(await model.rotateSecret(row.id, 'token-2')).toBeUndefined();
    expect(await model.getSecret(row.id)).toBe('token-1');
  });

  it('settles the config under the creation locks, validated like the input', async () => {
    const seen: unknown[] = [];
    const row = await model.createWithLimits(generic(), undefined, async (tx, config) => {
      // Runs inside the transaction: the rows already there are readable through it.
      seen.push(config);
      expect(tx).toBeDefined();
      return { ...config, identifier: 'ci-alerts-2' };
    });
    expect(seen).toEqual([{ autoApprove: false, topicMode: 'new' }]);
    if (row.kind !== 'generic') throw new Error('not narrowed');
    expect(row.config.identifier).toBe('ci-alerts-2');

    // A config the kind's schema refuses is not stored.
    await expect(
      model.createWithLimits(generic(), undefined, async (_tx, config) => ({
        ...config,
        identifier: 'Not An Identifier',
      })),
    ).rejects.toThrow();
    expect(await model.query({ kind: 'generic' })).toHaveLength(1);
  });
});
