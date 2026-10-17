import { buildUserSkillIdentifier } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { GoalRolloutLearning, GoalRolloutPlanSkill } from '@lobechat/types';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { type ExpertiseCarrier, ExpertiseModel } from '@/database/models/expertise';
import { expertiseBindings, expertiseDomains } from '@/database/schemas';

import { UserSkillService } from '../userSkill';

/**
 * A batch's execution plan lives as a skill in the user's own library, not as
 * text copied into every unit: units load the skill, each Template revision is
 * one of its versions, and the skill outlives the goal for reuse elsewhere.
 *
 * A gate break also teaches the batch. Its guidance becomes a rule in the
 * batch's expertise domain, and every later unit's acceptance adds it as a
 * clause it must meet (see `learnedRulesClause`) on top of the unit's own
 * contract — so a break revises the plan, the executor and the verifier
 * together.
 */

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 240;

const oneLine = (text: string, max: number) => {
  const line = text.replaceAll(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * A short skill name for a batch: `goal-plan-` and the first characters of its
 * id. The library keeps names unique, suffixing a clash.
 */
export const planSkillName = (batchNodeId: string) =>
  `goal-plan-${batchNodeId
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '')
    .slice(0, 8)}`;

export const planSkillIdentifier = (skill: GoalRolloutPlanSkill) =>
  buildUserSkillIdentifier(skill.name);

/**
 * A unit's brief. With a plan skill the brief names the skill — the run loads
 * its latest version — and still carries the plan as it stood at dispatch, so a
 * run that could not load the skill (deleted, or a failed read) works from the
 * plan rather than from nothing.
 */
export const planUnitBrief = (
  title: string,
  plan: { outline?: string; skill?: GoalRolloutPlanSkill },
): string =>
  plan.skill
    ? [
        `Unit: ${title}`,
        `Do this unit by the batch's execution plan, the skill \`${planSkillIdentifier(plan.skill)}\` loaded for this run. Follow its latest version.`,
        plan.outline &&
          `If that skill is not loaded in this run, follow the plan as it stood at dispatch:\n\n${plan.outline}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    : [plan.outline, `Unit: ${title}`].filter(Boolean).join('\n\n');

/**
 * The clause a batch unit's acceptance adds for what the batch learned: every
 * rule in full (the title is a truncated label), on top of the unit's own
 * contract.
 */
export const learnedRulesClause = (
  learnings: readonly Pick<GoalRolloutLearning, 'rule' | 'title'>[],
): string | undefined =>
  learnings.length
    ? `Rules this batch learned from its release gate (each must also hold):\n${learnings
        .map((learning) => `- ${(learning.rule ?? learning.title).trim()}`)
        .join('\n')}`
    : undefined;

/** The one expertise domain a carrier keeps for every goal batch it runs. */
export const BATCH_DOMAIN_TITLE = 'Goal batch rules';
/** Its gate question — with the title, how a generated batch domain is recognized. */
const BATCH_DOMAIN_FILTER = 'Doing or verifying a unit of a goal batch.';

export class BatchPlanSkillService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /** Writes v1 of a batch's plan as a user skill. */
  create = async (params: {
    batchNodeId: string;
    goalId: string;
    goalTitle: string;
    plan: string;
  }): Promise<GoalRolloutPlanSkill> => {
    const skill = await new UserSkillService(this.db, this.userId, this.workspaceId).createSkill({
      body: params.plan,
      description: oneLine(
        `How each unit of "${params.goalTitle}" is done. Revised whenever the batch's release gate sends it back.`,
        MAX_DESCRIPTION,
      ),
      name: planSkillName(params.batchNodeId),
      origin: { batchNodeId: params.batchNodeId, goalId: params.goalId, revision: 1 },
      title: oneLine(params.goalTitle, MAX_TITLE),
    });
    return { id: skill.id, name: skill.name };
  };

  /**
   * Moves a batch that predates plan skills into one: the plan's earlier
   * versions, oldest first, become the skill's versions, so version N still
   * reads as round N.
   */
  adopt = async (params: {
    batchNodeId: string;
    goalId: string;
    goalTitle: string;
    versions: string[];
  }): Promise<GoalRolloutPlanSkill | undefined> => {
    const [first, ...rest] = params.versions.filter((text) => text.trim());
    if (!first) return undefined;
    const skill = await this.create({ ...params, plan: first });
    for (const [index, plan] of rest.entries()) {
      await this.revise(skill, { goalId: params.goalId, plan, revision: index + 2 });
    }
    return skill;
  };

  /** Writes the plan's next version; returns its number. */
  revise = async (
    skill: GoalRolloutPlanSkill,
    params: { goalId: string; guidance?: string; plan: string; revision: number },
  ) =>
    new UserSkillService(this.db, this.userId, this.workspaceId).reviseSkill(skill.id, {
      body: params.plan,
      note: params.guidance,
      origin: { goalId: params.goalId, revision: params.revision },
    });

  /**
   * Teaches the batch what a break found: a rule in its expertise domain
   * (opened on the first break). Nothing is compiled from it: later units'
   * acceptance carries the rule as a clause of its requirement.
   */
  /**
   * The batch domain bound to exactly this carrier, if it has one. Not the
   * carrier's inherited list: an agent also sees the owner's domains, and a
   * rule meant for one agent must not land in a domain every agent inherits.
   */
  private findBatchDomain = async (carrier: ExpertiseCarrier) => {
    const binding =
      carrier.type === 'agent'
        ? eq(expertiseBindings.agentId, carrier.id)
        : carrier.type === 'project'
          ? eq(expertiseBindings.projectId, carrier.id)
          : and(
              this.workspaceId
                ? eq(expertiseBindings.boundWorkspaceId, this.workspaceId)
                : eq(expertiseBindings.boundUserId, this.userId),
              isNull(expertiseBindings.agentId),
              isNull(expertiseBindings.projectId),
            );
    const [row] = await this.db
      .select({ id: expertiseDomains.id })
      .from(expertiseBindings)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
      .where(
        and(
          binding,
          eq(expertiseDomains.userId, this.userId),
          eq(expertiseDomains.title, BATCH_DOMAIN_TITLE),
          eq(expertiseDomains.domainFilter, BATCH_DOMAIN_FILTER),
        ),
      )
      .limit(1);
    return row?.id;
  };

  learn = async (params: {
    /** Where the domain is mounted: the executing agent, else the user. */
    carrier: ExpertiseCarrier;
    domainId?: string;
    /** What the gate found, in words. */
    found: string;
    goalTitle: string;
    guidance: string;
    planSkill?: GoalRolloutPlanSkill;
    revision: number;
  }): Promise<{ domainId: string; learning: GoalRolloutLearning } | undefined> => {
    const expertise = new ExpertiseModel(this.db, this.userId, this.workspaceId);
    // Two goals on the same carrier can break at once, each under only its own
    // goal lock: serialize finding-or-creating the carrier's domain, so the
    // second sees the first's instead of creating another. Held until the
    // enclosing transaction ends.
    const carrierKey =
      params.carrier.type === 'user'
        ? `user:${this.workspaceId ?? this.userId}`
        : `${params.carrier.type}:${params.carrier.id}`;
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`goal-batch-domain:${carrierKey}`}))`,
    );
    // One domain per carrier for every batch it runs, not one per batch: each
    // run's expertise snapshot loads every domain its agent carries, so a
    // domain per batch would grow that load with every batch ever run.
    const domainId =
      params.domainId ??
      (await this.findBatchDomain(params.carrier)) ??
      (await expertise.createDomain({
        brief: 'What the release gates of goal batches have learned.',
        carrier: params.carrier,
        domainFilter: BATCH_DOMAIN_FILTER,
        title: BATCH_DOMAIN_TITLE,
      }));
    const scope = params.planSkill
      ? `the batch plan ${planSkillIdentifier(params.planSkill)}`
      : `the batch of "${params.goalTitle}"`;

    const title = oneLine(params.guidance, MAX_TITLE);
    const lesson = await expertise.createRule({
      compilability: 'compilable',
      domainId,
      enforcement: 'block',
      how: params.guidance,
      title,
      why: `The release gate of round ${params.revision} of ${scope} sent it back: ${params.found}`,
    });
    if (!lesson) return undefined;

    return {
      domainId,
      learning: {
        lessonCode: lesson.code,
        lessonId: lesson.id,
        revision: params.revision,
        rule: params.guidance,
        title,
      },
    };
  };
}
