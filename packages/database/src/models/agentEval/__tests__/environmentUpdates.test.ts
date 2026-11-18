import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentEvalEnvironments, users } from '../../../schemas';
import { AgentEvalEnvironmentBindingError, AgentEvalEnvironmentModel } from '../environment';

const db = await getTestDB();
const userId = 'atomic-environment-owner';
const otherId = 'atomic-environment-other';
const model = new AgentEvalEnvironmentModel(db, userId);
const originalBindings = { notion: { connectorId: '11111111-1111-4111-8111-111111111111' } };
const repairedBindings = { notion: { connectorId: '22222222-2222-4222-8222-222222222222' } };

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
});
afterEach(async () => {
  await db.delete(agentEvalEnvironments);
  await db.delete(users);
});

describe('Atomic Environment configuration updates', () => {
  it.each(['omitted', 'stale'] as const)(
    'preserves a concurrent connection repair when submitted bindings are %s',
    async (mode) => {
      const original = await model.create({
        config: { agent: { systemRole: 'Original persona' }, connectorBindings: originalBindings },
        name: 'Shared environment',
      });
      let announceLock!: () => void;
      let finishRepair!: () => void;
      const locked = new Promise<void>((resolve) => {
        announceLock = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finishRepair = resolve;
      });
      // Reproduce the Dataset repair transaction's row-lock/write sequence.
      const repair = db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(agentEvalEnvironments)
          .where(eq(agentEvalEnvironments.id, original.id))
          .for('update');
        announceLock();
        await release;
        await tx
          .update(agentEvalEnvironments)
          .set({
            config: { ...current.config, connectorBindings: repairedBindings },
          })
          .where(eq(agentEvalEnvironments.id, original.id));
      });
      await locked;
      const save = model.update(original.id, {
        config: {
          agent: { systemRole: 'Edited persona' },
          ...(mode === 'stale' ? { connectorBindings: originalBindings } : {}),
        },
      });
      const checked =
        mode === 'stale'
          ? expect(save).rejects.toBeInstanceOf(AgentEvalEnvironmentBindingError)
          : expect(save).resolves.toMatchObject({
              config: { connectorBindings: repairedBindings },
            });
      finishRepair();
      await Promise.all([repair, checked]);
      expect((await model.findById(original.id))?.config).toEqual({
        agent: { systemRole: mode === 'stale' ? 'Original persona' : 'Edited persona' },
        connectorBindings: repairedBindings,
      });
    },
  );

  it('accepts the unchanged migration configuration but rejects an explicit clear', async () => {
    const original = await model.create({
      config: { connectorBindings: originalBindings },
      name: 'Migration',
    });
    await expect(
      model.update(original.id, {
        config: {
          connectorBindings: { notion: { transport: 'mcp', ...originalBindings.notion } },
          timezone: 'UTC',
        },
      }),
    ).resolves.toMatchObject({ config: { connectorBindings: originalBindings, timezone: 'UTC' } });
    await expect(
      model.update(original.id, { config: { connectorBindings: {} } }),
    ).rejects.toBeInstanceOf(AgentEvalEnvironmentBindingError);
    expect((await model.findById(original.id))?.config).toEqual({
      connectorBindings: originalBindings,
      timezone: 'UTC',
    });
  });

  it("does not lock or update a different owner's Environment", async () => {
    const original = await new AgentEvalEnvironmentModel(db, otherId).create({
      config: { connectorBindings: originalBindings },
      name: 'Other owner',
    });
    expect(await model.update(original.id, { config: { connectorBindings: {} } })).toBeUndefined();
    const [stored] = await db
      .select()
      .from(agentEvalEnvironments)
      .where(eq(agentEvalEnvironments.id, original.id));
    expect(stored.config.connectorBindings).toEqual(originalBindings);
  });
});
