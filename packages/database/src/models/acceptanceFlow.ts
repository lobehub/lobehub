import { createHash } from 'node:crypto';

import { isDraftVerifyRun } from '@lobechat/const/verify';
import type {
  AcceptanceFlowDefinition,
  AcceptanceFlowReview,
  AcceptanceFlowVerdict,
  AcceptanceReviewAnnotation,
  VerifyCheckItem,
  VerifyFlowSnapshot,
} from '@lobechat/types';
import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  acceptanceFlowEdges as edges,
  acceptanceFlowNodes as nodes,
  acceptanceFlows as flows,
} from '../schemas/acceptanceFlow';
import {
  acceptances,
  verifyCheckResults,
  verifyCriteria,
  verifyEvidence,
  verifyRuns,
} from '../schemas/verify';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';
import { VerifyCriterionModel } from './verifyCriterion';

export function validateFlow(definition: AcceptanceFlowDefinition) {
  const ids = new Set(definition.nodes.map((n) => n.id));
  if (ids.size !== definition.nodes.length) throw new Error('Duplicate node ids');
  if (!ids.has(definition.entryNodeId)) throw new Error('Entry node not found');
  if (new Set(definition.edges.map((e) => e.id)).size !== definition.edges.length)
    throw new Error('Duplicate edge ids');
  for (const edge of definition.edges)
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId))
      throw new Error('Unknown edge endpoint');
  const reached = new Set([definition.entryNodeId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const edge of definition.edges)
      if (reached.has(edge.sourceNodeId) && !reached.has(edge.targetNodeId)) {
        reached.add(edge.targetNodeId);
        changed = true;
      }
  }
  if (reached.size !== ids.size) throw new Error('Unreachable nodes');
  for (const node of definition.nodes)
    if ([node.criterionId, node.check, node.subFlowId].filter(Boolean).length !== 1)
      throw new Error('Provide exactly one criterionId, check or subFlowId');
}

/** Canonical graph fingerprint, also used for optimistic editing and pending-plan detection. */
function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        isPlainRecord(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest('hex');
}

/** The newest round of a chain ordered by ascending `roundIndex`. */
function latestRound<T extends { roundIndex: number | null }>(rounds: T[]) {
  return rounds.findLast((round) => round.roundIndex != null);
}

/** Link each occurrence to the plan items earlier rounds recorded at the same graph position. */
function withSupersedes(
  plan: VerifyCheckItem[],
  priorPlans: (VerifyCheckItem[] | null | undefined)[],
  flowId: string,
) {
  return plan.map((item) => {
    const supersedes = [
      ...new Set(
        priorPlans
          .flatMap((p) => p ?? [])
          .filter(
            (p) =>
              p.id !== item.id &&
              p.sourceFlowNode?.flowId === flowId &&
              p.sourceFlowNode.nodeId === item.sourceFlowNode?.nodeId &&
              p.sourceFlowNode.incomingEdgeId === item.sourceFlowNode?.incomingEdgeId,
          )
          .map((p) => p.id),
      ),
    ];
    return supersedes.length ? { ...item, supersedes } : item;
  });
}

export class AcceptanceFlowModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  private async owned(acceptanceId: string, database: Pick<LobeChatDatabase, 'select'> = this.db) {
    const [row] = await database
      .select()
      .from(acceptances)
      .where(and(eq(acceptances.id, acceptanceId), eq(acceptances.userId, this.userId)));
    if (!row) throw new Error('Acceptance not found');
    return row;
  }

  async publish(
    acceptanceId: string,
    definition: AcceptanceFlowDefinition,
    flowId?: string,
    expectedHash?: string,
  ) {
    validateFlow(definition);
    const acceptance = await this.owned(acceptanceId);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, acceptanceId))
        .for('update');
      if (['accepted', 'closed'].includes(locked.status))
        throw new Error('Reopen acceptance before publishing');
      let flow;
      if (flowId) {
        [flow] = await tx
          .select()
          .from(flows)
          .where(and(eq(flows.id, flowId), eq(flows.acceptanceId, acceptanceId)))
          .for('update');
        if (!flow) throw new Error('Flow not found');
        const current = await this.graph(flow.id, tx);
        if (!expectedHash || expectedHash !== current.hash)
          throw new Error('Flow changed; reload before editing');
      } else {
        [flow] = await tx
          .insert(flows)
          .values({
            acceptanceId,
            title: definition.title,
          })
          .returning();
      }
      const scope = buildWorkspaceWhere(
        { userId: acceptance.userId, workspaceId: acceptance.workspaceId ?? undefined },
        verifyCriteria,
      );
      for (const node of definition.nodes) {
        if (node.subFlowId) {
          const [child] = await tx
            .select()
            .from(flows)
            .where(and(eq(flows.id, node.subFlowId), eq(flows.acceptanceId, acceptanceId)));
          if (!child) throw new Error('Subflow must belong to the same acceptance');
          if (node.overrides?.fixtureData)
            throw new Error('Fixture overrides belong to check nodes');
        } else if (node.check) {
          const { check } = node;
          verifyCheckDefinitionSchema.parse(check.definition);
          await tx
            .insert(verifyCriteria)
            .values({
              id: check.id,
              userId: acceptance.userId,
              workspaceId: acceptance.workspaceId,
              title: check.title,
              description: check.description,
              definition: check.definition,
              verifierType: 'agent',
            })
            .onConflictDoNothing();
          const [asset] = await tx
            .select()
            .from(verifyCriteria)
            .where(and(eq(verifyCriteria.id, check.id), scope));
          if (
            !asset ||
            asset.archivedAt ||
            asset.title !== check.title ||
            fingerprint(asset.definition) !== fingerprint(check.definition)
          )
            throw new Error('Check asset id already used');
        } else {
          const [asset] = await tx
            .select()
            .from(verifyCriteria)
            .where(and(eq(verifyCriteria.id, node.criterionId!), scope));
          if (!asset) throw new Error('Check asset not found');
        }
      }
      // Replacing positions is atomic; stable caller-supplied ids preserve round diffs.
      await tx.delete(edges).where(eq(edges.flowId, flow.id));
      await tx.delete(nodes).where(eq(nodes.flowId, flow.id));
      await tx.insert(nodes).values(
        definition.nodes.map((node) => ({
          id: node.id,
          flowId: flow.id,
          criterionId: node.criterionId ?? node.check?.id,
          subFlowId: node.subFlowId,
          isEntry: node.id === definition.entryNodeId,
          overrides: node.overrides,
        })),
      );
      if (definition.edges.length)
        await tx
          .insert(edges)
          .values(definition.edges.map((edge) => ({ ...edge, flowId: flow.id })));
      await tx
        .update(flows)
        .set({
          title: definition.title,
          updatedAt: new Date(),
        })
        .where(eq(flows.id, flow.id));
      await this.syncOpenRounds(acceptanceId, tx);
      return { flowId: flow.id, hash: (await this.graph(flow.id, tx)).hash };
    });
  }

  /**
   * Editing a graph before any round executes must not fork a new version:
   * refresh the snapshot and plan of the open draft, so the ledger keeps
   * describing the graph the editor shows. Only the newest round qualifies —
   * an older draft the ledger has moved past, and a replay pinned to a frozen
   * definition, both keep what they already hold.
   */
  private async syncOpenRounds(acceptanceId: string, tx: Transaction) {
    const rounds = await tx
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.acceptanceId, acceptanceId))
      .orderBy(asc(verifyRuns.roundIndex))
      .for('update');
    const open = latestRound(rounds);
    for (const round of open && isDraftVerifyRun(open) ? [open] : []) {
      if (!round.flowSnapshots?.length) continue;
      let plan = round.plan ?? [];
      const snapshots: VerifyFlowSnapshot[] = [];
      let changed = false;
      for (const snapshot of round.flowSnapshots) {
        const current = await this.graph(snapshot.flowId, tx);
        const existing = plan.filter((p) => p.sourceFlowNode?.flowId === snapshot.flowId);
        if (
          fingerprint(current.snapshot) === fingerprint(snapshot) &&
          fingerprint(existing.map((p) => p.id)) === fingerprint(current.plan.map((p) => p.id))
        ) {
          snapshots.push(snapshot);
          continue;
        }
        changed = true;
        snapshots.push(current.snapshot);
        const priorPlans = rounds.filter((r) => r.id !== round.id).map((r) => r.plan);
        const items = withSupersedes(current.plan, priorPlans, snapshot.flowId);
        const at = plan.findIndex((p) => p.sourceFlowNode?.flowId === snapshot.flowId);
        const rest = plan.filter((p) => p.sourceFlowNode?.flowId !== snapshot.flowId);
        plan =
          at === -1 ? [...rest, ...items] : [...rest.slice(0, at), ...items, ...rest.slice(at)];
      }
      if (!changed) continue;
      await tx
        .update(verifyRuns)
        .set({
          plan: plan.map((item, index) => ({ ...item, index })),
          flowSnapshots: snapshots,
        })
        .where(eq(verifyRuns.id, round.id));
    }
  }

  /**
   * Drop a graph the acceptance no longer describes.
   *
   * Authoring a journey takes several tries, and until now every try stayed on
   * the page forever: an abandoned first draft still renders as its own root
   * with its own unexecuted checks, so the reader cannot tell which graph the
   * delivery is actually being verified against.
   *
   * Only a graph without verified history can go. A settled round renders from
   * the snapshot it froze, so its results would outlive the map that explains
   * them. A draft has nothing to preserve: the flow's snapshot and plan items
   * are stripped from it, leaving the ledger as if the flow had never been
   * planned. Check assets the nodes pointed at are reusable on their own and
   * stay put.
   */
  async delete(acceptanceId: string, flowId: string) {
    await this.owned(acceptanceId);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, acceptanceId))
        .for('update');
      if (['accepted', 'closed'].includes(locked.status))
        throw new Error('Reopen acceptance before deleting a flow');
      const [flow] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.id, flowId), eq(flows.acceptanceId, acceptanceId)))
        .for('update');
      if (!flow) throw new Error('Flow not found');

      const [invoked] = await tx
        .select({ title: flows.title })
        .from(nodes)
        .innerJoin(flows, eq(nodes.flowId, flows.id))
        .where(eq(nodes.subFlowId, flowId));
      if (invoked)
        throw new Error(`"${invoked.title}" invokes this flow — remove that subflow node first`);

      const rounds = await tx
        .select()
        .from(verifyRuns)
        .where(eq(verifyRuns.acceptanceId, acceptanceId))
        .orderBy(asc(verifyRuns.roundIndex))
        .for('update');
      const carrying = rounds.filter((round) =>
        round.flowSnapshots?.some((snapshot) => snapshot.flowId === flowId),
      );
      const settled = carrying.find((round) => !isDraftVerifyRun(round));
      if (settled)
        throw new Error(
          `Round ${settled.roundIndex} verified this flow — delete that round first, or leave the graph in place`,
        );
      const planned = carrying.flatMap((round) =>
        (round.plan ?? [])
          .filter((item) => item.sourceFlowNode?.flowId === flowId)
          .map((item) => item.id),
      );
      const [recorded] = planned.length
        ? await tx
            .select({ id: verifyCheckResults.id })
            .from(verifyCheckResults)
            .where(inArray(verifyCheckResults.checkItemId, planned))
            .limit(1)
        : [];
      if (recorded) throw new Error('This flow already has recorded results');

      for (const round of carrying)
        await tx
          .update(verifyRuns)
          .set({
            plan: (round.plan ?? [])
              .filter((item) => item.sourceFlowNode?.flowId !== flowId)
              .map((item, index) => ({ ...item, index })),
            flowSnapshots: round.flowSnapshots!.filter((snapshot) => snapshot.flowId !== flowId),
          })
          .where(eq(verifyRuns.id, round.id));
      await tx.delete(flows).where(eq(flows.id, flowId));
      return { flowId, title: flow.title, unplannedRounds: carrying.map((round) => round.id) };
    });
  }

  private async graph(
    flowId: string,
    database: LobeChatDatabase | Transaction = this.db,
    ancestors: string[] = [],
  ): Promise<{ snapshot: VerifyFlowSnapshot; plan: VerifyCheckItem[]; hash: string }> {
    if (ancestors.includes(flowId)) throw new Error('Recursive subflow reference');
    if (ancestors.length >= 8) throw new Error('Subflow nesting exceeds 8 levels');
    const [flow] = await database.select().from(flows).where(eq(flows.id, flowId));
    if (!flow) throw new Error('Flow not found');
    const nodeRows = await database
      .select({ node: nodes, asset: verifyCriteria })
      .from(nodes)
      .leftJoin(verifyCriteria, eq(nodes.criterionId, verifyCriteria.id))
      .where(eq(nodes.flowId, flowId))
      .orderBy(asc(nodes.id));
    const edgeRows = await database
      .select()
      .from(edges)
      .where(eq(edges.flowId, flowId))
      .orderBy(asc(edges.id));
    const entry = nodeRows.find(({ node }) => node.isEntry)?.node.id;
    // Read each journey from its entry, keeping a branch together. UUID order
    // only breaks ties between sibling edges; it must not order the whole plan.
    const rowsById = new Map(nodeRows.map((row) => [row.node.id, row]));
    const outgoing = new Map<string, typeof edgeRows>();
    for (const edge of edgeRows) {
      const targets = outgoing.get(edge.sourceNodeId) ?? [];
      targets.push(edge);
      outgoing.set(edge.sourceNodeId, targets);
    }
    const orderedRows: typeof nodeRows = [];
    const visited = new Set<string>();
    const occurrenceOrder: string[] = [];
    const pending = entry ? [{ nodeId: entry, occurrenceId: 'entry' }] : [];
    while (pending.length) {
      const { nodeId: id, occurrenceId } = pending.pop()!;
      // Every incoming edge creates a check occurrence, including revisits.
      // Expand a node's outgoing edges only once to terminate cycles.
      occurrenceOrder.push(occurrenceId);
      if (visited.has(id)) continue;
      visited.add(id);
      const row = rowsById.get(id);
      if (!row) throw new Error('Unknown edge endpoint');
      orderedRows.push(row);
      pending.push(
        ...(outgoing.get(id) ?? [])
          .toReversed()
          .map((edge) => ({ nodeId: edge.targetNodeId, occurrenceId: edge.id })),
      );
    }
    if (orderedRows.length !== nodeRows.length) throw new Error('Unreachable nodes');
    const occurrencePlans = new Map<string, VerifyCheckItem[]>();
    const snapshot: VerifyFlowSnapshot = {
      flowId,
      title: flow.title,
      entryNodeId: entry ?? '',
      edges: edgeRows.map(({ flowId: _, ...edge }) => ({
        ...edge,
        condition: edge.condition ?? undefined,
      })),
      nodes: [],
    };
    for (const { node, asset } of orderedRows) {
      const branches: ((typeof edgeRows)[number] | undefined)[] = edgeRows.filter(
        (e) => e.targetNodeId === node.id,
      );
      if (node.isEntry) branches.unshift(undefined);
      if (node.subFlowId) {
        const child = await this.graph(node.subFlowId, database, [...ancestors, flowId]);
        const group = {
          id: node.id,
          subFlowId: node.subFlowId,
          title: child.snapshot.title,
          checkItemIds: [] as string[],
        };
        snapshot.nodes.push(group);
        for (const branch of branches) {
          const prefix = `${node.id}/${branch?.id ?? 'entry'}/`;
          const parentId = branches.length > 1 ? `${prefix}group` : node.id;
          const ids = child.plan.map((item) => prefix + item.id);
          group.checkItemIds.push(...ids);
          if (branches.length > 1)
            snapshot.nodes.push({
              id: parentId,
              parentNodeId: node.id,
              title: branch?.trigger ?? child.snapshot.title,
              subFlowId: node.subFlowId,
              checkItemIds: ids,
            });
          snapshot.nodes.push(
            ...child.snapshot.nodes.map((item) => ({
              ...item,
              id: prefix + item.id,
              parentNodeId: item.parentNodeId ? prefix + item.parentNodeId : parentId,
              checkItemIds: item.checkItemIds.map((id) => prefix + id),
            })),
          );
          snapshot.edges.push(
            ...child.snapshot.edges.map((edge) => ({
              ...edge,
              id: prefix + edge.id,
              sourceNodeId: prefix + edge.sourceNodeId,
              targetNodeId: prefix + edge.targetNodeId,
            })),
          );
          occurrencePlans.set(
            branch?.id ?? 'entry',
            child.plan.map((item) => ({
              ...item,
              id: prefix + item.id,
              required: (node.overrides?.required ?? branch?.required ?? true) && item.required,
              onFail: node.overrides?.onFail ?? item.onFail,
              sourceFlowNode: {
                flowId,
                nodeId: prefix + item.sourceFlowNode!.nodeId,
                incomingEdgeId: item.sourceFlowNode?.incomingEdgeId
                  ? prefix + item.sourceFlowNode.incomingEdgeId
                  : undefined,
              },
              definition: {
                ...item.definition,
                preconditions: [
                  ...(item.definition?.preconditions ?? []),
                  ...(branch
                    ? [branch.trigger, ...(branch.condition ? [branch.condition] : [])]
                    : []),
                ],
              },
            })),
          );
        }
        if (snapshot.nodes.length > 1000) throw new Error('Expanded flow exceeds 1000 nodes');
        continue;
      }
      if (!asset) throw new Error('Check asset not found');
      const definition = structuredClone(
        asset.definition ?? {
          expected:
            typeof asset.verifierConfig?.expected === 'string'
              ? asset.verifierConfig.expected
              : undefined,
          steps:
            typeof asset.verifierConfig?.method === 'string'
              ? [{ id: 'legacy-method', instruction: asset.verifierConfig.method }]
              : undefined,
        },
      );
      for (const [fixtureId, data] of Object.entries(node.overrides?.fixtureData ?? {})) {
        const fixture = definition.fixtures?.find((f) => f.id === fixtureId);
        if (!fixture) throw new Error('Unknown fixture override');
        fixture.data = data;
      }
      const itemIds: string[] = [];
      for (const branch of branches) {
        const id = `${node.id}:${branch?.id ?? 'entry'}`;
        itemIds.push(id);
        occurrencePlans.set(branch?.id ?? 'entry', [
          {
            id,
            index: 0,
            title: asset.title,
            description: asset.description ?? undefined,
            category: flow.title,
            sourceCriterionId: asset.id,
            sourceFlowNode: { flowId, nodeId: node.id, incomingEdgeId: branch?.id },
            definition: {
              ...definition,
              preconditions: [
                ...(definition.preconditions ?? []),
                ...(branch
                  ? [branch.trigger, ...(branch.condition ? [branch.condition] : [])]
                  : []),
              ],
            },
            documentId: asset.documentId,
            verifierType: asset.verifierType,
            verifierConfig: asset.verifierConfig ?? {},
            onFail: node.overrides?.onFail ?? asset.onFail,
            required: node.overrides?.required ?? branch?.required ?? true,
          },
        ]);
      }
      snapshot.nodes.push({
        id: node.id,
        criterionId: asset.id,
        isEntry: node.isEntry,
        checkItemIds: itemIds,
      });
    }
    const plan = occurrenceOrder
      .flatMap((id) => occurrencePlans.get(id)!)
      .map((item, index) => ({ ...item, index }));
    const acceptance = await this.owned(flow.acceptanceId, database);
    const frozen = await new VerifyCriterionModel(
      database,
      acceptance.userId,
      acceptance.workspaceId ?? undefined,
    ).materialize(plan, flow.acceptanceId);
    for (const item of frozen) {
      const oldId = item.id;
      item.id = `${oldId}:${fingerprint({ title: item.title, definition: item.definition, resources: item.resourceSnapshot, verifierConfig: item.verifierConfig }).slice(0, 12)}`;
      for (const node of snapshot.nodes)
        node.checkItemIds = node.checkItemIds.map((id) => (id === oldId ? item.id : id));
    }
    return { snapshot, plan: frozen, hash: fingerprint({ snapshot, plan: frozen }) };
  }

  async start(acceptanceId: string, flowId: string, verifyRunId?: string, sourceRunId?: string) {
    const acceptance = await this.owned(acceptanceId);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, acceptanceId))
        .for('update');
      if (['accepted', 'closed'].includes(locked.status)) throw new Error('Acceptance is closed');
      const [flow] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.id, flowId), eq(flows.acceptanceId, acceptanceId)))
        .for('update');
      if (!flow) throw new Error('Flow not found');
      let graph;
      if (sourceRunId) {
        const [source] = await tx
          .select()
          .from(verifyRuns)
          .where(and(eq(verifyRuns.id, sourceRunId), eq(verifyRuns.acceptanceId, acceptanceId)));
        const snapshot = source?.flowSnapshots?.find((s) => s.flowId === flowId);
        if (!snapshot) throw new Error('Flow snapshot not found');
        graph = {
          snapshot,
          plan: (source.plan ?? []).filter((p) => p.sourceFlowNode?.flowId === flowId),
        };
      } else graph = await this.graph(flowId, tx);
      if (!graph.snapshot.nodes.length) throw new Error('Empty flow');
      graph.plan = await new VerifyCriterionModel(
        tx,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      ).materialize(graph.plan, acceptanceId);
      if (!sourceRunId) {
        const priorRounds = await tx
          .select({ plan: verifyRuns.plan })
          .from(verifyRuns)
          .where(eq(verifyRuns.acceptanceId, acceptanceId));
        graph.plan = withSupersedes(
          graph.plan,
          priorRounds.map((r) => r.plan),
          flowId,
        );
      }
      if (!verifyRunId && !sourceRunId) {
        // Planning again is a refresh of the open draft, never another round.
        const latest = latestRound(
          await tx
            .select()
            .from(verifyRuns)
            .where(eq(verifyRuns.acceptanceId, acceptanceId))
            .orderBy(asc(verifyRuns.roundIndex))
            .for('update'),
        );
        const draft = latest && isDraftVerifyRun(latest) ? latest : undefined;
        if (draft) {
          verifyRunId = draft.id;
          if (draft.flowSnapshots?.some((s) => s.flowId === flowId)) {
            await this.syncOpenRounds(acceptanceId, tx);
            return { id: draft.id, verifyRunId: draft.id, flowId };
          }
        }
      }
      if (!verifyRunId) {
        const [last] = await tx
          .select()
          .from(verifyRuns)
          .where(eq(verifyRuns.acceptanceId, acceptanceId))
          .orderBy(desc(verifyRuns.roundIndex))
          .limit(1);
        const [created] = await tx
          .insert(verifyRuns)
          .values({
            acceptanceId,
            userId: acceptance.userId,
            workspaceId: acceptance.workspaceId,
            visibility: acceptance.visibility,
            roundIndex: (last?.roundIndex ?? 0) + 1,
            title: flow.title,
            status: 'planned',
            // A replay is pinned to the definition it replays, so it stays out
            // of the draft reuse and refresh paths.
            ...(sourceRunId ? { metadata: { replayOfRunId: sourceRunId } } : {}),
          })
          .returning();
        verifyRunId = created.id;
      }
      const [round] = await tx
        .select()
        .from(verifyRuns)
        .where(and(eq(verifyRuns.id, verifyRunId), eq(verifyRuns.acceptanceId, acceptanceId)))
        .for('update');
      if (!round || round.userDecision) throw new Error('An open verification round is required');
      if (round.flowSnapshots?.some((s) => s.flowId === flowId))
        return { id: round.id, verifyRunId: round.id, flowId };
      if (round.planConfirmedAt || ![null, 'planned'].includes(round.status))
        throw new Error('Verification plan is already frozen');
      await tx
        .update(verifyRuns)
        .set({
          plan: [
            ...(round.plan ?? []),
            ...graph.plan.map((p, i) => ({ ...p, index: (round.plan?.length ?? 0) + i })),
          ],
          flowSnapshots: [...(round.flowSnapshots ?? []), graph.snapshot],
        })
        .where(eq(verifyRuns.id, round.id));
      await tx
        .update(acceptances)
        .set({ status: 'planned', completedAt: null })
        .where(eq(acceptances.id, acceptanceId));
      return { id: round.id, verifyRunId: round.id, flowId };
    });
  }

  async record(
    acceptanceId: string,
    input: {
      verifyRunId: string;
      checkItemId: string;
      observation: string;
      verdict: AcceptanceFlowVerdict;
    },
  ) {
    const acceptance = await this.owned(acceptanceId);
    return this.db.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(verifyRuns)
        .where(and(eq(verifyRuns.id, input.verifyRunId), eq(verifyRuns.acceptanceId, acceptanceId)))
        .for('update');
      if (!round) throw new Error('Verification round not found');
      const item = round.plan?.find((p) => p.id === input.checkItemId && p.sourceFlowNode);
      if (!item) throw new Error('Flow check item not found');
      const [existing] = await tx
        .select()
        .from(verifyCheckResults)
        .where(
          and(
            eq(verifyCheckResults.verifyRunId, round.id),
            eq(verifyCheckResults.checkItemId, item.id),
          ),
        );
      const verdict = input.verdict === 'blocked' ? 'uncertain' : input.verdict;
      if (existing) {
        if (existing.verdict === verdict && existing.toulmin?.evidence === input.observation)
          return existing;
        throw new Error('Result already recorded; create a new verification round');
      }
      if (
        round.userDecision ||
        round.status === 'delivered' ||
        ['accepted', 'closed'].includes(acceptance.status)
      )
        throw new Error('Acceptance is closed');
      const [result] = await tx
        .insert(verifyCheckResults)
        .values({
          verifyRunId: round.id,
          userId: acceptance.userId,
          workspaceId: acceptance.workspaceId,
          checkItemId: item.id,
          sourceCriterionId: item.sourceCriterionId,
          checkItemTitle: item.title,
          required: item.required,
          verifierType: item.verifierType,
          status:
            input.verdict === 'passed'
              ? 'passed'
              : input.verdict === 'blocked'
                ? 'skipped'
                : 'failed',
          verdict,
          toulmin: { evidence: input.observation, reasoning: item.definition?.expected ?? '' },
        })
        .returning();
      await tx.insert(verifyEvidence).values({
        checkResultId: result.id,
        userId: acceptance.userId,
        workspaceId: acceptance.workspaceId,
        type: 'text',
        content: input.observation,
        description: item.title,
        capturedBy: 'cli',
      });
      await tx
        .update(verifyRuns)
        .set({
          status: 'collecting_evidence',
          planConfirmedAt: round.planConfirmedAt ?? new Date(),
        })
        .where(eq(verifyRuns.id, round.id));
      await tx
        .update(acceptances)
        .set({ status: 'verifying' })
        .where(eq(acceptances.id, acceptanceId));
      return result;
    });
  }

  async complete(acceptanceId: string, verifyRunId: string) {
    await this.owned(acceptanceId);
    return this.db.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(verifyRuns)
        .where(and(eq(verifyRuns.id, verifyRunId), eq(verifyRuns.acceptanceId, acceptanceId)))
        .for('update');
      if (!round || !round.flowSnapshots?.length) throw new Error('Flow round not found');
      if (round.userDecision) throw new Error('Round already reviewed');
      const results = await tx
        .select()
        .from(verifyCheckResults)
        .where(eq(verifyCheckResults.verifyRunId, round.id));
      if (
        round.plan?.some(
          (p) =>
            p.required && !results.some((r) => r.checkItemId === p.id && r.verdict === 'passed'),
        )
      )
        throw new Error('Required flow branches have not passed');
      const [updated] = await tx
        .update(verifyRuns)
        .set({ status: 'delivered', planConfirmedAt: round.planConfirmedAt ?? new Date() })
        .where(eq(verifyRuns.id, round.id))
        .returning();
      return updated;
    });
  }

  /** Compatibility presentation projection: versions are round snapshots, attempts are check results. */
  async list(acceptanceId: string) {
    await this.owned(acceptanceId);
    const flowRows = await this.db
      .select()
      .from(flows)
      .where(eq(flows.acceptanceId, acceptanceId))
      .orderBy(asc(flows.createdAt));
    const rounds = await this.db
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.acceptanceId, acceptanceId))
      .orderBy(desc(verifyRuns.roundIndex));
    const results = rounds.length
      ? await this.db
          .select()
          .from(verifyCheckResults)
          .where(
            inArray(
              verifyCheckResults.verifyRunId,
              rounds.map((r) => r.id),
            ),
          )
          .orderBy(asc(verifyCheckResults.createdAt), asc(verifyCheckResults.id))
      : [];
    const evidence = results.length
      ? await this.db
          .select()
          .from(verifyEvidence)
          .where(
            inArray(
              verifyEvidence.checkResultId,
              results.map((r) => r.id),
            ),
          )
      : [];
    const render = (
      snapshot: VerifyFlowSnapshot,
      plan: VerifyCheckItem[],
      round?: (typeof rounds)[number],
    ) => ({
      id: round ? `${round.id}:${snapshot.flowId}` : snapshot.flowId,
      flowId: snapshot.flowId,
      version: round?.roundIndex ?? 0,
      title: snapshot.title,
      entryNodeKey: snapshot.entryNodeId,
      nodes: snapshot.nodes.map((node) => {
        const item = plan.find((p) => node.checkItemIds.includes(p.id));
        return {
          id: node.id,
          nodeKey: node.id,
          criterionId: node.criterionId,
          subFlowId: node.subFlowId,
          parentNodeId: node.parentNodeId,
          isEntry: node.isEntry ?? node.id === snapshot.entryNodeId,
          checkItemIds: node.checkItemIds,
          requiredCheckItemIds: plan
            .filter((p) => p.required && node.checkItemIds.includes(p.id))
            .map((p) => p.id),
          entryRequired:
            plan.find(
              (p) => p.sourceFlowNode?.nodeId === node.id && !p.sourceFlowNode.incomingEdgeId,
            )?.required ?? true,
          title: node.title ?? item?.title ?? '',
          instruction: item?.definition?.steps?.map((s) => s.instruction).join('\n') ?? '',
          expected: item?.definition?.expected ?? '',
          definition: item?.definition,
          resourceSnapshot: item?.resourceSnapshot,
        };
      }),
      edges: snapshot.edges.map((edge) => ({
        ...edge,
        required:
          plan.find((p) => p.sourceFlowNode?.incomingEdgeId === edge.id)?.required ?? edge.required,
        edgeKey: edge.id,
        sourceNodeKey: edge.sourceNodeId,
        targetNodeKey: edge.targetNodeId,
      })),
      runs: round
        ? [
            {
              id: round.id,
              verifyRunId: round.id,
              status: round.status,
              attempts: results
                .filter(
                  (r) =>
                    r.verifyRunId === round.id &&
                    plan.some(
                      (p) => p.id === r.checkItemId && p.sourceFlowNode?.flowId === snapshot.flowId,
                    ),
                )
                .map((r, index) => {
                  const item = plan.find((p) => p.id === r.checkItemId)!;
                  return {
                    id: r.id,
                    checkResultId: r.id,
                    checkItemId: r.checkItemId,
                    nodeId: item.sourceFlowNode!.nodeId,
                    incomingEdgeId: item.sourceFlowNode!.incomingEdgeId ?? null,
                    sequence: index + 1,
                    observation: r.toulmin?.evidence ?? '',
                    verdict: (r.verdict ?? 'uncertain') as AcceptanceFlowVerdict,
                    review:
                      r.userDecision === 'accepted' || r.userDecision === 'rejected'
                        ? r.userDecision
                        : null,
                    reviewComment: r.userDecisionDetail?.comment ?? null,
                    reviewDetail: r.userDecisionDetail ?? null,
                    evidence: evidence.filter((e) => e.checkResultId === r.id),
                  };
                }),
            },
          ]
        : [],
    });
    return Promise.all(
      flowRows.map(async (flow) => {
        const current = await this.graph(flow.id);
        const history = rounds.flatMap((round) =>
          (round.flowSnapshots ?? [])
            .filter((s) => s.flowId === flow.id)
            .map((s) => render(s, round.plan ?? [], round)),
        );
        const currentView = render(current.snapshot, current.plan);
        const sameDefinition = history.some(
          (h) =>
            fingerprint({
              nodes: h.nodes,
              edges: h.edges,
              title: h.title,
            }) ===
            fingerprint({
              nodes: currentView.nodes,
              edges: currentView.edges,
              title: currentView.title,
            }),
        );
        return {
          ...flow,
          hash: current.hash,
          versions: sameDefinition ? history : [currentView, ...history],
        };
      }),
    );
  }

  async review(
    acceptanceId: string,
    resultId: string,
    review: AcceptanceFlowReview,
    comment: string,
    actor: string,
    feedback?: { annotations?: AcceptanceReviewAnnotation[]; fileIds?: string[] },
  ) {
    const data = await this.list(acceptanceId);
    const result = data
      .flatMap((f) => f.versions.flatMap((v) => v.runs.flatMap((r) => r.attempts)))
      .find((r) => r.id === resultId);
    if (!result) throw new Error('Result not found');
    if (
      feedback?.annotations?.some(
        (a) => !result.evidence.some((e) => e.id === a.evidenceId && e.type === 'screenshot'),
      )
    )
      throw new Error('Annotation must reference this result screenshot');
    const [updated] = await this.db
      .update(verifyCheckResults)
      .set({
        userDecision: review,
        userDecisionDetail: {
          ...feedback,
          comment,
          decidedBy: actor,
          decidedAt: new Date().toISOString(),
        },
      })
      .where(eq(verifyCheckResults.id, resultId))
      .returning();
    return updated;
  }
}
