import {
  GOAL_BATCH_ASSAY_TITLE,
  GOAL_BATCH_TEMPLATE_TITLE,
  GOAL_BATCH_TITLE,
  ROLLOUT_WAVE_SIZE_DEFAULT,
} from '@lobechat/const/goal';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  GoalRolloutPlanSkill,
  GoalRolloutPolicy,
  GoalRolloutState,
  GoalRolloutVariantAxis,
} from '@lobechat/types';
import debug from 'debug';

import type { GoalModel } from '@/database/models/goal';
import type { GoalGraphModel } from '@/database/models/goalGraph';

import { BatchPlanSkillService, planUnitBrief } from './batchPlanSkill';
import { unitsNamedByProbes } from './spec';

const log = debug('lobe-server:goal-rollout');

/** Upper bound on a batch roster; a planner that over-lists cannot swamp the config. */
export const MAX_ROLLOUT_ROSTER = 60;

/**
 * The roster the coordinator promotes from, probes first. The probe titles come
 * from the tasks actually created; the rest come from the planner's `units`,
 * de-duplicated. A planner that omitted `units` degrades to probes-only, which
 * delivers the class without a mass phase rather than inventing units.
 *
 * `limit` bounds the roster a *batch* carries (its config safety valve); the
 * ordinary fallback passes no limit, because trimming there would silently drop
 * units the goal promised to deliver.
 *
 * `matchUnitInProbeTitle` is for a model's roster, whose probe titles wrap the
 * unit: a unit a probe title names is that probe, not a second unit run again in
 * a wave (see `unitsNamedByProbes`). Rosters a person or Agent wrote keep exact
 * titles only.
 */
export const normalizeRolloutRoster = (
  units: string[] | undefined,
  probeDrafts: { title: string }[],
  canarySize: number,
  limit: number = MAX_ROLLOUT_ROSTER,
  { matchUnitInProbeTitle = false }: { matchUnitInProbeTitle?: boolean } = {},
): string[] => {
  const probeTitles = probeDrafts.slice(0, canarySize).map((draft) => draft.title);
  const seen = new Set(probeTitles);
  if (matchUnitInProbeTitle)
    for (const unit of unitsNamedByProbes(
      probeTitles,
      (units ?? []).map((unit) => unit.trim()),
    ).keys())
      seen.add(unit);
  const rest: string[] = [];
  for (const unit of units ?? []) {
    const title = unit.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    rest.push(title);
    if (probeTitles.length + rest.length >= limit) break;
  }
  return [...probeTitles, ...rest];
};

/** Heads the brief a unit carries over from its first run when it is re-opened. */
const UNIT_BRIEF_HEADING = 'Unit brief (from its first run):';

/**
 * The per-unit brief a re-opened unit must keep: the first-hand probe brief
 * (which may be the only place its variant assignment is stated), or the one a
 * previous re-open already carried over. A unit briefed only from the shared
 * recipe has none of its own.
 */
export const carriedUnitBrief = (node: { description?: string | null; title: string }) => {
  const description = node.description?.trim();
  if (!description) return undefined;
  const carried = description.indexOf(UNIT_BRIEF_HEADING);
  if (carried >= 0) return description.slice(carried + UNIT_BRIEF_HEADING.length).trim();
  return description.endsWith(`Unit: ${node.title}`) ? undefined : description;
};

/**
 * Materialize one roster unit as a Task inside a batch. The brief is the shared
 * recipe applied to this unit — the probes carry the full first-hand brief, the
 * units promoted later reuse what the Template already proved. A unit that came
 * with its own notes (an agent-declared roster), or a re-opened unit, also keeps
 * that brief. With a plan skill the brief names the skill rather than copying
 * the plan.
 */
export const createRecipeUnitTask = async (
  writer: GoalGraphModel,
  goalId: string,
  batchNodeId: string,
  title: string,
  plan: { outline?: string; skill?: GoalRolloutPlanSkill },
  unitBrief?: string,
): Promise<string | undefined> => {
  const node = await writer.createNode(goalId, {
    description: [planUnitBrief(title, plan), unitBrief && `${UNIT_BRIEF_HEADING}\n${unitBrief}`]
      .filter(Boolean)
      .join('\n\n'),
    kind: 'task',
    scopeId: batchNodeId,
    title,
  });
  return node?.id;
};

export interface RolloutBatchProbe {
  /** 0-based indices of earlier probes this one builds on. */
  dependsOn?: number[];
  instruction: string;
  title: string;
}

export interface MaterializeRolloutBatchInput {
  /** How many of `probes` run before the gate; the rest of the roster waits. */
  canarySize: number;
  /** The main Agent that declared the batch; absent when the system planner did. */
  createdByAgentId?: string;
  goalId: string;
  goalModel: GoalModel;
  /**
   * Where the batch's plan is written as a skill in the user's library (v1 of
   * it): the caller's transaction and owner. Units then load the skill rather
   * than copy the plan; without it, or when writing fails, they carry the
   * outline as before.
   */
  planSkillOwner?: {
    db: LobeChatDatabase;
    goalTitle: string;
    userId: string;
    workspaceId?: string;
  };
  /** The policy the caller already chose (trigger, sizes); persisted underneath. */
  policy?: GoalRolloutPolicy;
  probes: RolloutBatchProbe[];
  problemId: string;
  recipeOutline?: string;
  repeatable: boolean;
  /** The whole roster, probes first, in delivery order. */
  roster: string[];
  trigger: 'canary' | 'full';
  /** Per-unit notes keyed by roster title, appended to the recipe when a wave releases it. */
  unitBriefs?: Record<string, string>;
  variants?: GoalRolloutVariantAxis[];
  writer: GoalGraphModel;
}

/**
 * Lay one repeated mould onto the graph as a class rather than N flat siblings:
 * a `batch` container, its Template (the recipe), its Assay (the release gate)
 * and only the K probe tasks. The roster waits in `rolloutState`; the
 * coordinator releases it one wave at a time once the gate passes.
 *
 * Shared by the system planner (after `spec.ts` agrees with its claim) and by a
 * main Agent that declares the rollout in its own plan.
 */
export const materializeRolloutBatch = async ({
  canarySize,
  createdByAgentId,
  goalId,
  goalModel,
  planSkillOwner,
  policy,
  problemId,
  probes,
  recipeOutline,
  repeatable,
  roster,
  trigger,
  unitBriefs,
  variants,
  writer,
}: MaterializeRolloutBatchInput) => {
  const batch = await writer.createNode(goalId, {
    createdByAgentId,
    description: recipeOutline,
    kind: 'batch',
    title: GOAL_BATCH_TITLE,
  });
  if (!batch) throw new Error('Failed to create a planned batch');
  await writer.createEdge(goalId, problemId, batch.id, 'decomposes');

  const template = await writer.createNode(goalId, {
    createdByAgentId,
    description: recipeOutline,
    kind: 'finding',
    scopeId: batch.id,
    title: GOAL_BATCH_TEMPLATE_TITLE,
  });
  if (!template) throw new Error('Failed to create a batch template');

  // The plan as a skill in the user's library: units load it rather than copy
  // it, and it stays reusable after the goal. A savepoint keeps a failed write
  // from aborting the batch; the units then fall back to the copied outline.
  let planSkill: GoalRolloutPlanSkill | undefined;
  const outline = recipeOutline?.trim();
  if (outline && planSkillOwner) {
    try {
      planSkill = await planSkillOwner.db.transaction((savepoint) =>
        new BatchPlanSkillService(
          savepoint as unknown as LobeChatDatabase,
          planSkillOwner.userId,
          planSkillOwner.workspaceId,
        ).create({
          batchNodeId: batch.id,
          goalId,
          goalTitle: planSkillOwner.goalTitle,
          plan: outline,
        }),
      );
    } catch (error) {
      log('rollout batch: plan skill not written: %O', error);
    }
  }

  // The Assay is the gate. It is a `decision` node so a failed gate has
  // somewhere to hang the human question, but it carries NO pending
  // decision yet — opening one now would park the goal before a probe ran.
  // A `full` roll-out skips the probe, so it opens no gate at all.
  const assay =
    trigger === 'full'
      ? undefined
      : await writer.createNode(goalId, {
          createdByAgentId,
          description:
            'Whether this repeated batch can be delivered without further human decisions.',
          kind: 'decision',
          scopeId: batch.id,
          status: 'proposed',
          title: GOAL_BATCH_ASSAY_TITLE,
        });
  if (trigger !== 'full' && !assay) throw new Error('Failed to create a batch assay');

  const probeDrafts = probes.slice(0, canarySize);
  const probeIds: string[] = [];
  for (const draft of probeDrafts) {
    const node = await writer.createNode(goalId, {
      createdByAgentId,
      description: draft.instruction,
      kind: 'task',
      scopeId: batch.id,
      title: draft.title,
    });
    if (!node) throw new Error('Failed to create a probe task');
    probeIds.push(node.id);
  }

  // The gate depends on every probe: `selectFrontier` reads `depends_on`
  // as blocks, so the gate cannot be evaluated until they settle.
  if (assay) {
    for (const probeId of probeIds) {
      await writer.createEdge(goalId, assay.id, probeId, 'depends_on');
    }
  }
  // Honour the planner's own intra-probe dependencies too.
  for (const [index, draft] of probeDrafts.entries()) {
    for (const dep of new Set(draft.dependsOn ?? [])) {
      if (dep < index && probeIds[dep]) {
        await writer.createEdge(goalId, probeIds[index], probeIds[dep], 'depends_on');
      }
    }
  }

  // A `full` roll-out releases the rest of the roster immediately, as the
  // single wave the trigger promises; `canary` waits for the gate.
  const massNodeIds: string[] = [];
  if (trigger === 'full') {
    for (const title of roster.slice(probeIds.length)) {
      const nodeId = await createRecipeUnitTask(
        writer,
        goalId,
        batch.id,
        title,
        { outline: recipeOutline, skill: planSkill },
        unitBriefs?.[title],
      );
      if (nodeId) massNodeIds.push(nodeId);
    }
  }

  const rolloutState: GoalRolloutState = {
    batchNodeId: batch.id,
    assayNodeId: assay?.id,
    massNodeIds: massNodeIds.length ? massNodeIds : undefined,
    phase: trigger === 'full' ? 'mass' : 'probe',
    planSkill,
    probeNodeIds: probeIds,
    releasedCount: probeIds.length + massNodeIds.length,
    templateNodeId: template.id,
    templateRevision: 1,
    unitTitles: roster,
    waveIndex: trigger === 'full' ? 1 : 0,
  };
  await goalModel.updateRolloutState(goalId, rolloutState);

  // Always persist what was derived — later waves brief their tasks from the
  // recipe and the gate checks its variant axes — while keeping whatever the
  // caller chose (trigger, sizes) on top.
  await goalModel.updateRolloutPolicy(goalId, {
    ...policy,
    canarySize: trigger === 'full' ? undefined : (policy?.canarySize ?? canarySize),
    spec: { recipeOutline, repeatable, variantAxes: variants },
    trigger,
    unitBriefs: unitBriefs && Object.keys(unitBriefs).length ? unitBriefs : undefined,
    units: roster,
    waveSize: policy?.waveSize ?? ROLLOUT_WAVE_SIZE_DEFAULT,
  });

  return { batchId: batch.id, massNodeIds, probeDrafts, probeIds };
};
