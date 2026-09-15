// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { AcceptanceFlowDefinition } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users, verifyCheckResults, verifyCriteria, verifyRuns } from '../../schemas';
import { AcceptanceFlowModel, validateFlow } from '../acceptanceFlow';

const db = await getTestDB();
const owner = 'flow-asset-owner';
const other = 'flow-asset-other';
const model = new AcceptanceFlowModel(db, owner);
let acceptanceId: string;
let definition: AcceptanceFlowDefinition;
beforeEach(async () => {
  await db
    .insert(users)
    .values([{ id: owner }, { id: other }])
    .onConflictDoNothing();
  const [acceptance] = await db
    .insert(acceptances)
    .values({ userId: owner, subjectType: 'standalone', subjectId: randomUUID() })
    .returning();
  acceptanceId = acceptance.id;
  definition = journeyDefinition('Send and retry');
});

/** The same two-state journey with fresh ids, so one acceptance can hold several. */
function journeyDefinition(title: string): AcceptanceFlowDefinition {
  const first = randomUUID();
  const second = randomUUID();
  return {
    title,
    entryNodeId: first,
    nodes: [
      {
        id: first,
        check: {
          id: randomUUID(),
          title: 'Ready',
          definition: {
            steps: [{ id: 'open', instruction: 'Open chat' }],
            expected: 'Composer visible',
          },
        },
      },
      {
        id: second,
        check: {
          id: randomUUID(),
          title: 'Failure shown',
          definition: {
            steps: [{ id: 'send', instruction: 'Send offline' }],
            expected: 'Retry available',
          },
        },
      },
    ],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: first,
        targetNodeId: second,
        trigger: 'Send offline',
        required: true,
      },
      {
        id: randomUUID(),
        sourceNodeId: second,
        targetNodeId: first,
        trigger: 'Retry',
        required: true,
      },
    ],
  };
}
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, other));
});

async function roundPlan(id: string) {
  const [run] = await db.select().from(verifyRuns).where(eq(verifyRuns.id, id));
  return run;
}

describe('check assets and round snapshots', () => {
  it('reads from the entry through each branch instead of sorting checks by UUID', async () => {
    const ids = [9, 5, 1, 3].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    const titles = ['Choose how to continue', 'Reassign', 'Handoff complete', 'Wait for recovery'];
    const journey: AcceptanceFlowDefinition = {
      title: 'Continue work',
      entryNodeId: ids[0],
      nodes: ids.map((id, i) => ({
        id,
        check: { id: randomUUID(), title: titles[i], definition: { expected: titles[i] } },
      })),
      edges: [
        [0, 1],
        [1, 2],
        [0, 3],
        [2, 0],
        [3, 2],
      ].map(([source, target], i) => ({
        id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
        sourceNodeId: ids[source],
        targetNodeId: ids[target],
        trigger: `${titles[source]} to ${titles[target]}`,
        required: true,
      })),
    };
    const { flowId } = await model.publish(acceptanceId, journey);
    const run = await model.start(acceptanceId, flowId);
    const round = await roundPlan(run.id);
    expect(round.flowSnapshots?.[0].nodes.map((node) => node.id)).toEqual(ids);
    expect(round.plan?.map((item) => item.title)).toEqual([
      titles[0],
      titles[1],
      titles[2],
      titles[0],
      titles[3],
      titles[2],
    ]);
    expect(round.plan?.map((item) => item.sourceFlowNode?.incomingEdgeId)).toEqual([
      undefined,
      journey.edges[0].id,
      journey.edges[1].id,
      journey.edges[3].id,
      journey.edges[2].id,
      journey.edges[4].id,
    ]);
    expect(round.plan?.map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5]);
    const replay = await model.start(acceptanceId, flowId, undefined, run.id);
    expect((await roundPlan(replay.id)).plan).toEqual(round.plan);
  });

  it('keeps expanded subflow checks together at each traversed occurrence', async () => {
    const child = await model.publish(acceptanceId, definition);
    const a = randomUUID();
    const b = randomUUID();
    const forward = randomUUID();
    const back = randomUUID();
    const parent = await model.publish(acceptanceId, {
      title: 'Retry journey',
      entryNodeId: a,
      nodes: [
        { id: a, subFlowId: child.flowId },
        { id: b, subFlowId: child.flowId },
      ],
      edges: [
        { id: forward, sourceNodeId: a, targetNodeId: b, trigger: 'Continue', required: true },
        { id: back, sourceNodeId: b, targetNodeId: a, trigger: 'Retry', required: true },
      ],
    });
    const run = await model.start(acceptanceId, parent.flowId);
    const round = await roundPlan(run.id);
    // The child joins the same draft round; read its own occurrences back.
    const childRun = await model.start(acceptanceId, child.flowId);
    const childPlan = (await roundPlan(childRun.id)).plan!.filter(
      (item) => item.sourceFlowNode?.flowId === child.flowId,
    );
    const expectedIds = [`${a}/entry/`, `${b}/${forward}/`, `${a}/${back}/`].flatMap((prefix) =>
      childPlan.map((item) => prefix + item.id),
    );
    expect(round.plan).toHaveLength(expectedIds.length);
    expect(round.plan!.map((item) => item.id.slice(0, item.id.lastIndexOf(':')))).toEqual(
      expectedIds,
    );
    expect(round.plan!.map((item) => item.index)).toEqual(expectedIds.map((_, index) => index));
    const replay = await model.start(acceptanceId, parent.flowId, undefined, run.id);
    expect((await roundPlan(replay.id)).plan).toEqual(round.plan);
  });

  it.each(['accepted', 'closed'] as const)(
    'requires reopening a %s acceptance before starting or replaying',
    async (status) => {
      const published = await model.publish(acceptanceId, definition);
      const original = await model.start(acceptanceId, published.flowId);
      await db.update(acceptances).set({ status }).where(eq(acceptances.id, acceptanceId));
      await expect(model.start(acceptanceId, published.flowId)).rejects.toThrow(
        'Acceptance is closed',
      );
      await expect(
        model.start(acceptanceId, published.flowId, undefined, original.id),
      ).rejects.toThrow('Acceptance is closed');
      await expect(model.start(acceptanceId, published.flowId, original.id)).rejects.toThrow(
        'Acceptance is closed',
      );
      expect(
        await db.select().from(verifyRuns).where(eq(verifyRuns.acceptanceId, acceptanceId)),
      ).toHaveLength(1);
      const [current] = await db.select().from(acceptances).where(eq(acceptances.id, acceptanceId));
      expect(current.status).toBe(status);
    },
  );

  it('records a prepared draft without a separate confirmation and freezes it on execution', async () => {
    const { flowId } = await model.publish(acceptanceId, definition);
    const run = await model.start(acceptanceId, flowId);
    const draft = await roundPlan(run.id);
    expect(draft.planConfirmedAt).toBeNull();
    await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: draft.plan![0].id,
      verdict: 'passed',
      observation: 'Execution after inspecting the draft requires no extra confirmation',
    });
    expect((await roundPlan(run.id)).status).toBe('collecting_evidence');
    expect((await roundPlan(run.id)).planConfirmedAt).not.toBeNull();
    const replay = await model.start(acceptanceId, flowId, undefined, run.id);
    expect((await roundPlan(replay.id)).planConfirmedAt).toBeNull();
  });

  it('keeps a planned round on the live graph while the flow is edited before execution', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const run = await model.start(acceptanceId, flowId);
    const third = randomUUID();
    const revised: AcceptanceFlowDefinition = {
      ...definition,
      title: 'Send, retry and recover',
      nodes: [
        ...definition.nodes,
        {
          id: third,
          check: {
            id: randomUUID(),
            title: 'Recovered',
            definition: {
              steps: [{ id: 'reconnect', instruction: 'Reconnect' }],
              expected: 'Message delivered',
            },
          },
        },
      ],
      edges: [
        ...definition.edges,
        {
          id: randomUUID(),
          sourceNodeId: definition.nodes[1].id,
          targetNodeId: third,
          trigger: 'Reconnect',
          required: true,
        },
      ],
    };
    await model.publish(acceptanceId, revised, flowId, hash);
    const round = await roundPlan(run.id);
    expect(round.status).toBe('planned');
    expect(round.flowSnapshots?.[0].title).toBe('Send, retry and recover');
    expect(round.flowSnapshots?.[0].nodes.map((n) => n.id)).toContain(third);
    expect(round.plan?.map((p) => p.sourceFlowNode?.nodeId)).toContain(third);
    expect(round.plan?.map((p) => p.index)).toEqual(round.plan?.map((_, i) => i));
    const [flow] = await model.list(acceptanceId);
    expect(flow.versions).toHaveLength(1);
    expect(flow.versions[0].runs[0]?.id).toBe(run.id);
    expect(flow.versions[0].title).toBe('Send, retry and recover');
  });

  it('plans again into the same draft round instead of opening another', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const draft = await model.start(acceptanceId, flowId);
    expect((await model.start(acceptanceId, flowId)).id).toBe(draft.id);
    await model.publish(acceptanceId, { ...definition, title: 'Renamed draft' }, flowId, hash);
    const again = await model.start(acceptanceId, flowId);
    expect(again.id).toBe(draft.id);
    const round = await roundPlan(draft.id);
    expect(round.roundIndex).toBe(1);
    expect(round.flowSnapshots?.[0].title).toBe('Renamed draft');
    expect(
      await db.select().from(verifyRuns).where(eq(verifyRuns.acceptanceId, acceptanceId)),
    ).toHaveLength(1);
  });

  it('leaves an abandoned older draft alone once a newer round has taken over', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const stale = await model.start(acceptanceId, flowId);
    const staleSnapshot = (await roundPlan(stale.id)).flowSnapshots;
    // A replay opens its own round and pins the definition it replays.
    const replay = await model.start(acceptanceId, flowId, undefined, stale.id);
    expect(replay.id).not.toBe(stale.id);
    await model.record(acceptanceId, {
      verifyRunId: replay.id,
      checkItemId: (await roundPlan(replay.id)).plan![0].id,
      verdict: 'passed',
      observation: 'Composer visible',
    });

    // The newest round is frozen now, so the stale draft must not be reused…
    await model.publish(acceptanceId, { ...definition, title: 'Edited later' }, flowId, hash);
    expect((await roundPlan(stale.id)).flowSnapshots).toEqual(staleSnapshot);
    const fresh = await model.start(acceptanceId, flowId);
    expect(fresh.id).not.toBe(stale.id);
    expect((await roundPlan(fresh.id)).roundIndex).toBe(3);
  });

  it('keeps a replay pinned to the definition it replays while it is still unexecuted', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const first = await model.start(acceptanceId, flowId);
    await model.record(acceptanceId, {
      verifyRunId: first.id,
      checkItemId: (await roundPlan(first.id)).plan![0].id,
      verdict: 'passed',
      observation: 'Composer visible',
    });
    const replay = await model.start(acceptanceId, flowId, undefined, first.id);
    const pinned = await roundPlan(replay.id);

    await model.publish(acceptanceId, { ...definition, title: 'Edited later' }, flowId, hash);

    const after = await roundPlan(replay.id);
    expect(after.flowSnapshots).toEqual(pinned.flowSnapshots);
    expect(after.plan).toEqual(pinned.plan);
    // The replay is a numbered round, so planning again opens the next one.
    expect((await model.start(acceptanceId, flowId)).id).not.toBe(replay.id);
  });

  it('leaves an executed round frozen when the flow is edited afterwards', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const run = await model.start(acceptanceId, flowId);
    const before = await roundPlan(run.id);
    await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: before.plan![0].id,
      verdict: 'passed',
      observation: 'Composer visible',
    });
    await model.publish(acceptanceId, { ...definition, title: 'Renamed after run' }, flowId, hash);
    const after = await roundPlan(run.id);
    expect(after.flowSnapshots).toEqual(before.flowSnapshots);
    expect(after.plan).toEqual(before.plan);
    const [flow] = await model.list(acceptanceId);
    expect(flow.versions.map((v) => v.title)).toEqual(['Renamed after run', 'Send and retry']);
  });

  it('creates assets before execution and instantiates each incoming branch in the canonical plan', async () => {
    const published = await model.publish(acceptanceId, definition);
    expect(
      await db.select().from(verifyCriteria).where(eq(verifyCriteria.userId, owner)),
    ).toHaveLength(2);
    expect(await db.select().from(verifyCheckResults)).toHaveLength(0);
    const run = await model.start(acceptanceId, published.flowId);
    const round = await roundPlan(run.id);
    expect(round.plan).toHaveLength(3);
    expect(round.flowSnapshots?.[0].nodes).toHaveLength(2);
    expect(round.plan?.every((p) => p.sourceCriterionId && p.definition?.expected)).toBe(true);
    expect((await model.start(acceptanceId, published.flowId, run.id)).id).toBe(run.id);
  });

  it('requires every mandatory branch and writes directly to canonical results with idempotent evidence', async () => {
    const { flowId } = await model.publish(acceptanceId, definition);
    const run = await model.start(acceptanceId, flowId);
    const plan = (await roundPlan(run.id)).plan!;
    const input = {
      verifyRunId: run.id,
      checkItemId: plan[0].id,
      verdict: 'passed' as const,
      observation: 'Composer visible',
    };
    const result = await model.record(acceptanceId, input);
    expect((await model.record(acceptanceId, input)).id).toBe(result.id);
    expect(result.sourceCriterionId).toBe(plan[0].sourceCriterionId);
    expect(result.checkItemId).toBe(plan[0].id);
    await expect(model.complete(acceptanceId, run.id)).rejects.toThrow('Required flow branches');
    await expect(model.record(acceptanceId, { ...input, verdict: 'failed' })).rejects.toThrow(
      'new verification round',
    );
    for (const item of plan.slice(1))
      await model.record(acceptanceId, { ...input, checkItemId: item.id });
    await model.complete(acceptanceId, run.id);
    await model.review(acceptanceId, result.id, 'accepted', 'Reviewed', owner);
    const view = (await model.list(acceptanceId))[0].versions.find((v) =>
      v.runs.some((r) => r.id === run.id),
    )!;
    expect(view.runs[0].attempts.map((a) => a.checkItemId)).toEqual(plan.map((p) => p.id));
    expect((await roundPlan(run.id)).status).toBe('delivered');
    const fresh = await model.start(acceptanceId, flowId);
    expect((await roundPlan(fresh.id)).plan?.map((p) => p.id)).toEqual(plan.map((p) => p.id));
    expect(
      await db
        .select()
        .from(verifyCheckResults)
        .where(eq(verifyCheckResults.verifyRunId, fresh.id)),
    ).toHaveLength(0);
  });

  it('keeps old definitions unchanged after asset edits and allows replay of the frozen round', async () => {
    const { flowId } = await model.publish(acceptanceId, definition);
    const first = await model.start(acceptanceId, flowId);
    const initial = await roundPlan(first.id);
    // Executing freezes the round; only a frozen round keeps the old definition.
    await model.record(acceptanceId, {
      verifyRunId: first.id,
      checkItemId: initial.plan![0].id,
      verdict: 'passed',
      observation: 'Composer visible',
    });
    const assetId = definition.nodes[0].check!.id;
    await db
      .update(verifyCriteria)
      .set({ title: 'New criterion', definition: { expected: 'New expectation' } })
      .where(eq(verifyCriteria.id, assetId));
    const current = await model.start(acceptanceId, flowId);
    const replay = await model.start(acceptanceId, flowId, undefined, first.id);
    expect((await roundPlan(first.id)).plan).toEqual(initial.plan);
    expect((await roundPlan(replay.id)).plan).toEqual(initial.plan);
    expect(current.id).not.toBe(first.id);
    expect(
      (await roundPlan(current.id)).plan?.find((p) => p.sourceCriterionId === assetId)?.definition
        ?.expected,
    ).toBe('New expectation');
    const data = await model.list(acceptanceId);
    expect(
      data[0].versions
        .find((v) => v.runs[0]?.id === first.id)
        ?.nodes.find((n) => n.criterionId === assetId)?.expected,
    ).toBe('Composer visible');
  });

  it('reuses one asset in different positions and rejects cross-user references', async () => {
    const { flowId, hash } = await model.publish(acceptanceId, definition);
    const shared = definition.nodes[0].check!.id;
    definition.nodes = definition.nodes.map((n) => ({ id: n.id, criterionId: shared }));
    await model.publish(acceptanceId, definition, flowId, hash);
    expect((await model.list(acceptanceId))[0].versions[0].nodes.map((n) => n.criterionId)).toEqual(
      [shared, shared],
    );
    await expect(new AcceptanceFlowModel(db, other).start(acceptanceId, flowId)).rejects.toThrow(
      'Acceptance not found',
    );
    const [foreign] = await db
      .insert(verifyCriteria)
      .values({ userId: other, title: 'Private', verifierType: 'agent' })
      .returning();
    definition.nodes[0] = { id: definition.nodes[0].id, criterionId: foreign.id };
    await expect(
      model.publish(acceptanceId, definition, flowId, (await model.list(acceptanceId))[0].hash),
    ).rejects.toThrow('Check asset not found');
  });

  it('detects concurrent graph edits and keeps assets after deleting the acceptance', async () => {
    const published = await model.publish(acceptanceId, definition);
    const revised = { ...definition, title: 'Updated graph' };
    await model.publish(acceptanceId, revised, published.flowId, published.hash);
    await expect(
      model.publish(acceptanceId, definition, published.flowId, published.hash),
    ).rejects.toThrow('Flow changed');
    await db.delete(acceptances).where(eq(acceptances.id, acceptanceId));
    expect(
      await db.select().from(verifyCriteria).where(eq(verifyCriteria.userId, owner)),
    ).toHaveLength(2);
  });

  it('keeps two business flows and their results separate in one verification round', async () => {
    definition.nodes[0].check!.definition.preconditions = ['Signed in'];
    const first = await model.publish(acceptanceId, definition);
    const nodeId = randomUUID();
    const second = await model.publish(acceptanceId, {
      title: 'View group profile',
      entryNodeId: nodeId,
      nodes: [{ id: nodeId, criterionId: definition.nodes[0].check!.id }],
      edges: [],
    });
    const run = await model.start(acceptanceId, first.flowId);
    await model.start(acceptanceId, second.flowId, run.id);
    const round = await roundPlan(run.id);
    expect(round.flowSnapshots?.map((flow) => flow.flowId)).toEqual([first.flowId, second.flowId]);
    expect(round.plan).toHaveLength(4);
    const firstItems = round.plan!.filter((item) => item.sourceFlowNode?.flowId === first.flowId);
    const secondItem = round.plan!.find((item) => item.sourceFlowNode?.flowId === second.flowId)!;
    expect(secondItem.definition?.preconditions).toEqual(['Signed in']);
    expect(new Set(round.plan!.map((item) => item.id)).size).toBe(4);
    for (const item of firstItems)
      await model.record(acceptanceId, {
        verifyRunId: run.id,
        checkItemId: item.id,
        verdict: 'passed',
        observation: 'Verified',
      });
    await expect(model.complete(acceptanceId, run.id)).rejects.toThrow('Required flow branches');
    const views = await model.list(acceptanceId);
    const viewFor = (flowId: string) =>
      views.find((flow) => flow.id === flowId)!.versions.find((v) => v.runs[0]?.id === run.id)!;
    expect(viewFor(first.flowId).runs[0].attempts).toHaveLength(3);
    expect(viewFor(second.flowId).runs[0].attempts).toHaveLength(0);
    await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: secondItem.id,
      verdict: 'passed',
      observation: 'Profile ready',
    });
    await model.complete(acceptanceId, run.id);
    expect((await roundPlan(run.id)).status).toBe('delivered');
    expect((await roundPlan(run.id)).flowSnapshots).toEqual(round.flowSnapshots);
  });

  it('freezes composed flows and isolates repeated subflow occurrences', async () => {
    const child = await model.publish(acceptanceId, definition);
    const a = randomUUID(),
      b = randomUUID();
    const parentDefinition: AcceptanceFlowDefinition = {
      title: 'End to end',
      entryNodeId: a,
      nodes: [
        { id: a, subFlowId: child.flowId },
        { id: b, subFlowId: child.flowId },
      ],
      edges: [
        { id: randomUUID(), sourceNodeId: a, targetNodeId: b, trigger: 'Continue', required: true },
      ],
    };
    const parent = await model.publish(acceptanceId, parentDefinition);
    const run = await model.start(acceptanceId, parent.flowId);
    const initial = await roundPlan(run.id);
    expect(initial.plan).toHaveLength(6);
    expect(initial.plan!.map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(initial.plan!.map((item) => item.id)).size).toBe(6);
    const firstItems = initial.plan!.filter((item) =>
      item.sourceFlowNode?.nodeId.startsWith(a + '/'),
    );
    expect(firstItems).toHaveLength(3);
    for (const item of firstItems)
      await model.record(acceptanceId, {
        verifyRunId: run.id,
        checkItemId: item.id,
        verdict: 'passed',
        observation: 'First occurrence only',
      });
    await expect(model.complete(acceptanceId, run.id)).rejects.toThrow('Required flow branches');
    const version = (await model.list(acceptanceId))
      .find((flow) => flow.id === parent.flowId)!
      .versions.find((v) => v.runs[0]?.id === run.id)!;
    expect(version.runs[0].attempts).toHaveLength(3);
    expect(version.runs[0].attempts.every((visit) => visit.nodeId.startsWith(a + '/'))).toBe(true);
    expect(version.nodes.filter((n) => n.subFlowId)).toHaveLength(2);
    await model.publish(
      acceptanceId,
      { ...definition, title: 'Revised child' },
      child.flowId,
      child.hash,
    );
    const replay = await model.start(acceptanceId, parent.flowId, undefined, run.id);
    expect((await roundPlan(replay.id)).flowSnapshots).toEqual(initial.flowSnapshots);
    expect((await roundPlan(replay.id)).plan).toEqual(initial.plan);
    const fresh = await model.start(acceptanceId, parent.flowId);
    expect(
      (await roundPlan(fresh.id)).flowSnapshots?.[0].nodes.find((n) => n.id === a)?.title,
    ).toBe('Revised child');
    await expect(
      model.publish(
        acceptanceId,
        {
          ...definition,
          nodes: [{ id: definition.entryNodeId, subFlowId: parent.flowId }],
          edges: [],
        },
        child.flowId,
        (await model.list(acceptanceId)).find((flow) => flow.id === child.flowId)!.hash,
      ),
    ).rejects.toThrow('Recursive subflow');
    const [otherAcceptance] = await db
      .insert(acceptances)
      .values({ userId: owner, subjectType: 'standalone', subjectId: randomUUID() })
      .returning();
    await expect(model.publish(otherAcceptance.id, parentDefinition)).rejects.toThrow(
      'same acceptance',
    );
  });

  it('deletes an abandoned graph and unplans it from the open draft', async () => {
    const abandoned = await model.publish(acceptanceId, definition);
    const kept = await model.publish(acceptanceId, journeyDefinition('Second attempt'));
    const draft = await model.start(acceptanceId, abandoned.flowId);
    await model.start(acceptanceId, kept.flowId, draft.id);
    expect((await roundPlan(draft.id)).flowSnapshots).toHaveLength(2);

    const removed = await model.delete(acceptanceId, abandoned.flowId);
    expect(removed.title).toBe('Send and retry');
    expect((await model.list(acceptanceId)).map((flow) => flow.id)).toEqual([kept.flowId]);
    const round = await roundPlan(draft.id);
    expect(round.flowSnapshots?.map((snapshot) => snapshot.flowId)).toEqual([kept.flowId]);
    expect(round.plan?.every((item) => item.sourceFlowNode?.flowId === kept.flowId)).toBe(true);
    expect(round.plan?.map((item) => item.index)).toEqual(round.plan?.map((_, index) => index));
  });

  it('refuses to delete a graph a round has already verified', async () => {
    const { flowId } = await model.publish(acceptanceId, definition);
    const run = await model.start(acceptanceId, flowId);
    await model.record(acceptanceId, {
      verifyRunId: run.id,
      checkItemId: (await roundPlan(run.id)).plan![0].id,
      verdict: 'passed',
      observation: 'Composer visible',
    });
    await expect(model.delete(acceptanceId, flowId)).rejects.toThrow('verified this flow');
    expect(await model.list(acceptanceId)).toHaveLength(1);
  });

  it('refuses to delete a graph another flow invokes as a subflow', async () => {
    const child = await model.publish(acceptanceId, definition);
    const occurrence = randomUUID();
    const parent = await model.publish(acceptanceId, {
      title: 'End to end',
      entryNodeId: occurrence,
      nodes: [{ id: occurrence, subFlowId: child.flowId }],
      edges: [],
    });
    await expect(model.delete(acceptanceId, child.flowId)).rejects.toThrow('invokes this flow');
    await model.delete(acceptanceId, parent.flowId);
    await model.delete(acceptanceId, child.flowId);
    expect(await model.list(acceptanceId)).toHaveLength(0);
  });

  it('rejects unreachable nodes and missing entry points', () => {
    expect(() => validateFlow({ ...definition, entryNodeId: randomUUID() })).toThrow('Entry node');
    expect(() => validateFlow({ ...definition, edges: [] })).toThrow('Unreachable');
  });
});
