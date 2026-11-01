// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { AcceptanceFlowDefinition } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyCriteria, verifyRuns } from '../../schemas';
import {
  acceptanceFlowNodes as nodes,
  acceptanceFlows as flows,
} from '../../schemas/acceptanceFlow';
import { AcceptanceFlowModel } from '../acceptanceFlow';

const db = await getTestDB();
const owner = 'flow-guard-owner';
const model = new AcceptanceFlowModel(db, owner);
let acceptanceId: string;

beforeEach(async () => {
  await db.insert(users).values({ id: owner }).onConflictDoNothing();
  const [acceptance] = await db
    .insert(acceptances)
    .values({ userId: owner, subjectType: 'standalone', subjectId: randomUUID() })
    .returning();
  acceptanceId = acceptance.id;
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
});

/** A single-check graph whose asset id is caller supplied, so reuse can be exercised. */
function singleCheckFlow(
  title: string,
  checkId: string,
  definition: { expected?: string; fixtures?: { data?: any; id: string; name: string }[] },
  overrides?: { fixtureData?: Record<string, Record<string, unknown>> },
): AcceptanceFlowDefinition {
  const nodeId = randomUUID();
  return {
    title,
    entryNodeId: nodeId,
    nodes: [
      {
        id: nodeId,
        check: { id: checkId, title, definition },
        overrides,
      },
    ],
    edges: [],
  };
}

describe('publish rejects invalid graph content', () => {
  it('refuses fixture overrides on a subflow node', async () => {
    const child = await model.publish(acceptanceId, singleCheckFlow('Child', randomUUID(), {}));
    const nodeId = randomUUID();

    await expect(
      model.publish(acceptanceId, {
        title: 'Parent',
        entryNodeId: nodeId,
        nodes: [
          { id: nodeId, subFlowId: child.flowId, overrides: { fixtureData: { f1: { a: 1 } } } },
        ],
        edges: [],
      }),
    ).rejects.toThrow('Fixture overrides belong to check nodes');

    expect(await model.list(acceptanceId)).toHaveLength(1);
  });

  it('refuses a check whose asset id is already taken by another definition', async () => {
    const checkId = randomUUID();
    await model.publish(acceptanceId, singleCheckFlow('Ready', checkId, { expected: 'Ready' }));

    await expect(
      model.publish(acceptanceId, singleCheckFlow('Ready', checkId, { expected: 'Other' })),
    ).rejects.toThrow('Check asset id already used');
  });

  it('refuses to reuse an archived check asset id', async () => {
    const checkId = randomUUID();
    await model.publish(acceptanceId, singleCheckFlow('Ready', checkId, { expected: 'Ready' }));
    await db
      .update(verifyCriteria)
      .set({ archivedAt: new Date() })
      .where(eq(verifyCriteria.id, checkId));

    await expect(
      model.publish(acceptanceId, singleCheckFlow('Ready', checkId, { expected: 'Ready' })),
    ).rejects.toThrow('Check asset id already used');
  });

  it('rejects an unknown fixture override and applies a known one', async () => {
    const checkId = randomUUID();
    const definition = {
      fixtures: [{ id: 'account', name: 'Account', data: { plan: 'free' } }],
      steps: [{ id: 'open', instruction: 'Open billing' }],
    };

    await expect(
      model.publish(
        acceptanceId,
        singleCheckFlow('Billing', checkId, definition, { fixtureData: { missing: { a: 1 } } }),
      ),
    ).rejects.toThrow('Unknown fixture override');

    const { flowId } = await model.publish(
      acceptanceId,
      singleCheckFlow('Billing', checkId, definition, {
        fixtureData: { account: { plan: 'team' } },
      }),
    );

    const run = await model.start(acceptanceId, flowId);
    const [round] = await db.select().from(verifyRuns).where(eq(verifyRuns.id, run.id));
    expect(round.plan?.[0].definition?.fixtures?.[0].data).toEqual({ plan: 'team' });
  });
});

describe('graph guards on inconsistent rows', () => {
  it('reports a node that no edge reaches', async () => {
    const checkId = randomUUID();
    const { flowId } = await model.publish(
      acceptanceId,
      singleCheckFlow('Ready', checkId, { expected: 'Ready' }),
    );
    await db.insert(nodes).values({ flowId, criterionId: checkId, isEntry: false });

    await expect(model.list(acceptanceId)).rejects.toThrow('Unreachable nodes');
  });

  it('stops expanding subflows past eight levels of nesting', async () => {
    const [leafAsset] = await db
      .insert(verifyCriteria)
      .values({
        userId: owner,
        title: 'Leaf',
        definition: { expected: 'Leaf' },
        verifierType: 'agent',
      })
      .returning();

    const flowIds: string[] = [];
    for (let depth = 0; depth < 10; depth++) {
      const [flow] = await db
        .insert(flows)
        .values({ acceptanceId, title: `Depth ${depth}` })
        .returning();
      flowIds.push(flow.id);
    }
    for (let depth = 0; depth < flowIds.length; depth++) {
      const next = flowIds[depth + 1];
      await db.insert(nodes).values({
        flowId: flowIds[depth],
        isEntry: true,
        ...(next ? { subFlowId: next } : { criterionId: leafAsset.id }),
      });
    }

    await expect(model.list(acceptanceId)).rejects.toThrow('Subflow nesting exceeds 8 levels');
  });
});
