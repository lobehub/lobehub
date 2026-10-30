// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { AcceptanceFlowDefinition, VerifyCheckDefinition } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyCheckResults, verifyCriteria, verifyRuns } from '../../schemas';
import {
  acceptanceFlowNodes as nodes,
  acceptanceFlows as flows,
} from '../../schemas/acceptanceFlow';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceFlowModel } from '../acceptanceFlow';
import { createProxyTestDB } from './_proxyTestDB';

const db = await getTestDB();
const owner = 'afcov-owner';
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
  vi.restoreAllMocks();
  await db.delete(users).where(eq(users.id, owner));
});

const checkNode = (id: string, title: string, definition: VerifyCheckDefinition = {}) => ({
  id,
  check: { id: randomUUID(), title, definition },
});

/** Entry → second, both fresh check assets. */
const twoStep = (title: string, definition?: VerifyCheckDefinition): AcceptanceFlowDefinition => {
  const first = randomUUID();
  const second = randomUUID();
  return {
    title,
    entryNodeId: first,
    nodes: [
      checkNode(first, 'First', definition ?? { expected: 'First ok' }),
      checkNode(second, 'Second', definition ?? { expected: 'Second ok' }),
    ],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: first,
        targetNodeId: second,
        trigger: 'Go',
        required: true,
      },
    ],
  };
};

const roundById = async (id: string) => {
  const [run] = await db.select().from(verifyRuns).where(eq(verifyRuns.id, id));
  return run;
};

const seedRound = async (values: Partial<typeof verifyRuns.$inferInsert>) => {
  const [run] = await db
    .insert(verifyRuns)
    .values({ acceptanceId, userId: owner, ...values })
    .returning();
  return run;
};

describe('AcceptanceFlowModel coverage · draft refresh', () => {
  it('skips an open draft that carries no flow snapshots', async () => {
    const draft = await seedRound({ roundIndex: 1, status: 'planned' });

    const published = await model.publish(acceptanceId, twoStep('Fresh'));

    expect(published.flowId).toBeTruthy();
    const after = await roundById(draft.id);
    expect(after.flowSnapshots).toBeNull();
    expect(after.plan).toBeNull();
  });

  it('rebuilds a draft whose plan is missing, next to an older round without a plan', async () => {
    const older = await seedRound({ roundIndex: 1, status: 'delivered' });
    const definition = twoStep('Original');
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const draft = await model.start(acceptanceId, flowId);
    expect(draft.id).not.toBe(older.id);
    expect((await roundById(draft.id)).roundIndex).toBe(2);
    // The prior round has no plan, so nothing is superseded.
    expect((await roundById(draft.id)).plan!.every((item) => !item.supersedes)).toBe(true);

    await db.update(verifyRuns).set({ plan: null }).where(eq(verifyRuns.id, draft.id));
    await model.publish(acceptanceId, { ...definition, title: 'Renamed' }, flowId, hash);

    const refreshed = await roundById(draft.id);
    expect(refreshed.flowSnapshots?.[0].title).toBe('Renamed');
    expect(refreshed.plan).toHaveLength(2);
    expect(refreshed.plan!.map((item) => item.index)).toEqual([0, 1]);
    expect(refreshed.plan!.every((item) => item.sourceFlowNode?.flowId === flowId)).toBe(true);
    expect(refreshed.plan!.every((item) => !item.supersedes)).toBe(true);
    expect((await roundById(older.id)).plan).toBeNull();
  });
});

describe('AcceptanceFlowModel coverage · delete and replay with missing plans', () => {
  it('unplans a draft whose plan column is empty', async () => {
    const { flowId } = await model.publish(acceptanceId, twoStep('Abandoned'));
    const draft = await model.start(acceptanceId, flowId);
    await db.update(verifyRuns).set({ plan: null }).where(eq(verifyRuns.id, draft.id));

    const removed = await model.delete(acceptanceId, flowId);

    expect(removed).toEqual({ flowId, title: 'Abandoned', unplannedRounds: [draft.id] });
    const round = await roundById(draft.id);
    expect(round.plan).toEqual([]);
    expect(round.flowSnapshots).toEqual([]);
    expect(await db.select().from(flows).where(eq(flows.id, flowId))).toHaveLength(0);
  });

  it('replays a source round that froze a snapshot but no plan', async () => {
    const { flowId } = await model.publish(acceptanceId, twoStep('Replayed'));
    const source = await model.start(acceptanceId, flowId);
    const snapshot = (await roundById(source.id)).flowSnapshots;
    await db.update(verifyRuns).set({ plan: null }).where(eq(verifyRuns.id, source.id));

    const replay = await model.start(acceptanceId, flowId, undefined, source.id);

    expect(replay.id).not.toBe(source.id);
    const round = await roundById(replay.id);
    expect(round.plan).toEqual([]);
    expect(round.flowSnapshots).toEqual(snapshot);
    expect(round.metadata).toMatchObject({ replayOfRunId: source.id });
  });
});

describe('AcceptanceFlowModel coverage · graph expansion', () => {
  it('adds edge conditions to preconditions for checks and subflow occurrences', async () => {
    const childEntry = randomUUID();
    const child = await model.publish(acceptanceId, {
      title: 'Child',
      entryNodeId: childEntry,
      nodes: [checkNode(childEntry, 'Child check', { expected: 'ok' })],
      edges: [],
    });
    const entry = randomUUID();
    const sub = randomUUID();
    const tail = randomUUID();
    const toSub = randomUUID();
    const toTail = randomUUID();
    const parent = await model.publish(acceptanceId, {
      title: 'Parent',
      entryNodeId: entry,
      nodes: [
        checkNode(entry, 'Entry', { expected: 'Start' }),
        { id: sub, subFlowId: child.flowId },
        checkNode(tail, 'Tail', { expected: 'Done', preconditions: ['Signed in'] }),
      ],
      edges: [
        {
          id: toSub,
          sourceNodeId: entry,
          targetNodeId: sub,
          trigger: 'Open child',
          condition: 'When online',
          required: true,
        },
        {
          id: toTail,
          sourceNodeId: sub,
          targetNodeId: tail,
          trigger: 'Finish',
          condition: 'If child passed',
          required: true,
        },
      ],
    });

    const run = await model.start(acceptanceId, parent.flowId);
    const plan = (await roundById(run.id)).plan!;

    expect(plan.map((item) => item.title)).toEqual(['Entry', 'Child check', 'Tail']);
    expect(plan[0].definition?.preconditions).toEqual([]);
    expect(plan[1].definition?.preconditions).toEqual(['Open child', 'When online']);
    // The child entry has no incoming edge of its own inside the child graph.
    expect(plan[1].sourceFlowNode).toEqual({
      flowId: parent.flowId,
      nodeId: `${sub}/${toSub}/${childEntry}`,
      incomingEdgeId: undefined,
    });
    expect(plan[2].definition?.preconditions).toEqual(['Signed in', 'Finish', 'If child passed']);
  });

  it('builds a legacy definition from verifier config when an asset has none', async () => {
    const [legacy, bare, nullConfig] = await db
      .insert(verifyCriteria)
      .values([
        {
          userId: owner,
          title: 'Legacy',
          verifierType: 'agent',
          verifierConfig: { expected: 'Legacy expected', method: 'Click legacy' },
        },
        { userId: owner, title: 'Bare', verifierType: 'agent', verifierConfig: {} },
        { userId: owner, title: 'Null config', verifierType: 'agent', verifierConfig: null },
      ])
      .returning();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const { flowId } = await model.publish(acceptanceId, {
      title: 'Legacy flow',
      entryNodeId: ids[0],
      nodes: [
        { id: ids[0], criterionId: legacy.id },
        { id: ids[1], criterionId: bare.id },
        { id: ids[2], criterionId: nullConfig.id },
      ],
      edges: [
        {
          id: randomUUID(),
          sourceNodeId: ids[0],
          targetNodeId: ids[1],
          trigger: 'A',
          required: true,
        },
        {
          id: randomUUID(),
          sourceNodeId: ids[1],
          targetNodeId: ids[2],
          trigger: 'B',
          required: true,
        },
      ],
    });

    const run = await model.start(acceptanceId, flowId);
    const plan = (await roundById(run.id)).plan!;

    expect(plan.map((item) => item.title)).toEqual(['Legacy', 'Bare', 'Null config']);
    expect(plan[0].definition?.expected).toBe('Legacy expected');
    expect(plan[0].definition?.steps).toEqual([
      { id: 'legacy-method', instruction: 'Click legacy' },
    ]);
    expect(plan[1].definition?.expected).toBeUndefined();
    expect(plan[1].definition?.steps).toBeUndefined();
    expect(plan[2].definition?.expected).toBeUndefined();
    expect(plan[2].definition?.steps).toBeUndefined();
    expect(plan[2].verifierConfig).toEqual({});
  });

  it('refuses a graph whose subflow expansion exceeds 1000 nodes', async () => {
    const [asset] = await db
      .insert(verifyCriteria)
      .values({
        userId: owner,
        title: 'Step',
        verifierType: 'agent',
        definition: { expected: 'x' },
      })
      .returning();
    const childIds = Array.from({ length: 20 }, () => randomUUID());
    const child = await model.publish(acceptanceId, {
      title: 'Wide child',
      entryNodeId: childIds[0],
      nodes: childIds.map((id) => ({ id, criterionId: asset.id })),
      edges: childIds.slice(1).map((id, i) => ({
        id: randomUUID(),
        sourceNodeId: childIds[i],
        targetNodeId: id,
        trigger: `Step ${i}`,
        required: true,
      })),
    });
    const entry = randomUUID();
    const sub = randomUUID();

    await expect(
      model.publish(acceptanceId, {
        title: 'Exploding parent',
        entryNodeId: entry,
        nodes: [
          { id: entry, criterionId: asset.id },
          { id: sub, subFlowId: child.flowId },
        ],
        // 50 parallel edges → 50 occurrences × (group + 20 child nodes) > 1000.
        edges: Array.from({ length: 50 }, (_, i) => ({
          id: randomUUID(),
          sourceNodeId: entry,
          targetNodeId: sub,
          trigger: `Path ${i}`,
          required: true,
        })),
      }),
    ).rejects.toThrow('Expanded flow exceeds 1000 nodes');

    const remaining = await db.select().from(flows).where(eq(flows.acceptanceId, acceptanceId));
    expect(remaining.map((flow) => flow.id)).toEqual([child.flowId]);
  });

  it('reports a check node whose asset disappeared inside the same transaction', async () => {
    const definition = twoStep('Vanishing');
    const { flowId } = await model.publish(acceptanceId, definition);
    const assetId = definition.nodes[1].check!.id;

    // The node FK is deferred to commit, so a transaction can briefly see a node without its asset.
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(verifyCriteria).where(eq(verifyCriteria.id, assetId));
        await new AcceptanceFlowModel(tx as unknown as LobeChatDatabase, owner).list(acceptanceId);
      }),
    ).rejects.toThrow('Check asset not found');

    expect(
      await db.select().from(verifyCriteria).where(eq(verifyCriteria.id, assetId)),
    ).toHaveLength(1);
    expect((await model.list(acceptanceId)).map((flow) => flow.id)).toEqual([flowId]);
  });

  it('reports a subflow node whose flow disappeared inside the same transaction', async () => {
    const child = await model.publish(acceptanceId, twoStep('Child'));
    const occurrence = randomUUID();
    const parent = await model.publish(acceptanceId, {
      title: 'Parent',
      entryNodeId: occurrence,
      nodes: [{ id: occurrence, subFlowId: child.flowId }],
      edges: [],
    });

    // The subflow FK is deferred to commit, so a transaction can briefly see a dangling occurrence.
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(flows).where(eq(flows.id, child.flowId));
        await new AcceptanceFlowModel(tx as unknown as LobeChatDatabase, owner).list(acceptanceId);
      }),
    ).rejects.toThrow('Flow not found');

    expect((await model.list(acceptanceId)).map((flow) => flow.id).sort()).toEqual(
      [child.flowId, parent.flowId].sort(),
    );
  });

  it('re-prefixes nested group parents when a subflow itself contains a subflow', async () => {
    const leafEntry = randomUUID();
    const leaf = await model.publish(acceptanceId, {
      title: 'Leaf',
      entryNodeId: leafEntry,
      nodes: [checkNode(leafEntry, 'Leaf check', { expected: 'Leaf ok' })],
      edges: [],
    });
    const middleEntry = randomUUID();
    const middle = await model.publish(acceptanceId, {
      title: 'Middle',
      entryNodeId: middleEntry,
      nodes: [{ id: middleEntry, subFlowId: leaf.flowId }],
      edges: [],
    });
    const top = randomUUID();
    const root = await model.publish(acceptanceId, {
      title: 'Root',
      entryNodeId: top,
      nodes: [{ id: top, subFlowId: middle.flowId }],
      edges: [],
    });

    const run = await model.start(acceptanceId, root.flowId);
    const snapshot = (await roundById(run.id)).flowSnapshots![0];

    const prefix = `${top}/entry/`;
    expect(snapshot.nodes.map((node) => [node.id, node.parentNodeId])).toEqual([
      [top, undefined],
      [`${prefix}${middleEntry}`, top],
      [`${prefix}${middleEntry}/entry/${leafEntry}`, `${prefix}${middleEntry}`],
    ]);
  });

  it('reports an edge whose target node is missing from the node read', async () => {
    const definition = twoStep('Torn read');
    const { flowId } = await model.publish(acceptanceId, definition);
    const missing = definition.nodes[1].id;
    // A concurrent republish between the node and edge reads can leave an edge without its node.
    const torn = createProxyTestDB(db, (query, result) =>
      query.includes('from "acceptance_flow_nodes" left join')
        ? result.rows.filter((row) => row[0] !== missing)
        : result.rows,
    );

    await expect(new AcceptanceFlowModel(torn, owner).list(acceptanceId)).rejects.toThrow(
      'Unknown edge endpoint',
    );
    expect(await db.select().from(nodes).where(eq(nodes.flowId, flowId))).toHaveLength(2);
  });
});

describe('AcceptanceFlowModel coverage · record and complete', () => {
  it('stores a blocked verdict as skipped/uncertain and a failure as failed', async () => {
    const { flowId } = await model.publish(
      acceptanceId,
      twoStep('No expectation', { steps: [{ id: 'open', instruction: 'Open' }] }),
    );
    const run = await model.start(acceptanceId, flowId);
    const plan = (await roundById(run.id)).plan!;

    const blocked = await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: plan[0].id,
      verdict: 'blocked',
      observation: 'Environment down',
    });
    const failed = await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: plan[1].id,
      verdict: 'failed',
      observation: 'Broken',
    });

    expect(blocked).toMatchObject({ status: 'skipped', verdict: 'uncertain' });
    expect(blocked.toulmin).toEqual({ evidence: 'Environment down', reasoning: '' });
    expect(failed).toMatchObject({ status: 'failed', verdict: 'failed' });
    // Re-recording the same blocked observation is idempotent.
    expect(
      (
        await model.record(acceptanceId, {
          verifyRunId: run.id,
          checkItemId: plan[0].id,
          verdict: 'blocked',
          observation: 'Environment down',
        })
      ).id,
    ).toBe(blocked.id);
  });

  it('completes an untouched round with only optional checks and stamps its confirmation', async () => {
    const nodeId = randomUUID();
    const { flowId } = await model.publish(acceptanceId, {
      title: 'Optional only',
      entryNodeId: nodeId,
      nodes: [
        { ...checkNode(nodeId, 'Optional', { expected: 'Maybe' }), overrides: { required: false } },
      ],
      edges: [],
    });
    const run = await model.start(acceptanceId, flowId);
    expect((await roundById(run.id)).planConfirmedAt).toBeNull();

    const completed = await model.complete(acceptanceId, run.id);

    expect(completed.status).toBe('delivered');
    expect(completed.planConfirmedAt).toBeInstanceOf(Date);
  });
});

describe('AcceptanceFlowModel coverage · list projection', () => {
  it('renders rounds without snapshots, without plans and results without detail', async () => {
    const { flowId } = await model.publish(acceptanceId, twoStep('Projected'));
    const empty = await seedRound({ roundIndex: 1, status: 'delivered' });
    const run = await model.start(acceptanceId, flowId);
    const plan = (await roundById(run.id)).plan!;
    await db
      .update(verifyRuns)
      .set({ plan: null, status: 'delivered' })
      .where(eq(verifyRuns.id, run.id));
    const [bareResult] = await db
      .insert(verifyCheckResults)
      .values({
        verifyRunId: run.id,
        userId: owner,
        checkItemId: plan[0].id,
        verifierType: 'agent',
      })
      .returning();

    const [flow] = await model.list(acceptanceId);

    expect(flow.id).toBe(flowId);
    // The empty round contributes no history; the plan-less round still renders its snapshot.
    expect(flow.versions.map((v) => v.runs[0]?.id)).toEqual([undefined, run.id]);
    const history = flow.versions[1];
    expect(history.nodes.map((n) => n.title)).toEqual(['', '']);
    expect(history.nodes.map((n) => n.expected)).toEqual(['', '']);
    expect(history.nodes.map((n) => n.requiredCheckItemIds)).toEqual([[], []]);
    // Without plan items, the result cannot be attributed to this flow.
    expect(history.runs[0].attempts).toEqual([]);
    expect(flow.versions.some((v) => v.runs[0]?.id === empty.id)).toBe(false);
    expect(bareResult.toulmin).toBeNull();
  });

  it('defaults an attempt without evidence text or verdict', async () => {
    const { flowId } = await model.publish(acceptanceId, twoStep('Bare attempts'));
    const run = await model.start(acceptanceId, flowId);
    const plan = (await roundById(run.id)).plan!;
    const [bareResult] = await db
      .insert(verifyCheckResults)
      .values({
        verifyRunId: run.id,
        userId: owner,
        checkItemId: plan[0].id,
        verifierType: 'agent',
      })
      .returning();

    const [flow] = await model.list(acceptanceId);
    const attempt = flow.versions
      .flatMap((v) => v.runs)
      .flatMap((r) => r.attempts)
      .find((a) => a.id === bareResult.id)!;

    expect(attempt).toMatchObject({
      observation: '',
      verdict: 'uncertain',
      review: null,
      reviewComment: null,
      reviewDetail: null,
      evidence: [],
    });
    expect(
      await db.select().from(verifyCheckResults).where(eq(verifyCheckResults.verifyRunId, run.id)),
    ).toHaveLength(1);
  });
});
