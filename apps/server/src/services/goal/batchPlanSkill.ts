import { buildUserSkillIdentifier } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { GoalRolloutLearning, GoalRolloutPlanSkill } from '@lobechat/types';

import { type ExpertiseCarrier, ExpertiseModel } from '@/database/models/expertise';

import { UserSkillService } from '../userSkill';
import { VerifyPlanGeneratorService } from '../verify/planGenerator';

/**
 * A batch's execution plan lives as a skill in the user's own library, not as
 * text copied into every unit: units load the skill, each Template revision is
 * one of its versions, and the skill outlives the goal for reuse elsewhere.
 *
 * A gate break also teaches the batch. Its guidance becomes a rule in the
 * batch's expertise domain — the executor reads it as context — and the rule
 * compiles into a verify criterion every later unit is judged against. So a
 * break revises the plan, the executor and the verifier together.
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
 * it, so a revised plan reaches every unit dispatched after the revision —
 * instead of copying a plan that would go stale.
 */
export const unitBrief = (
  title: string,
  plan: { outline?: string; skill?: GoalRolloutPlanSkill },
): string =>
  plan.skill
    ? [
        `Unit: ${title}`,
        `Do this unit by the batch's execution plan, the skill \`${planSkillIdentifier(plan.skill)}\` loaded for this run. Follow its latest version.`,
      ].join('\n\n')
    : [plan.outline, `Unit: ${title}`].filter(Boolean).join('\n\n');

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
   * (opened on the first break), compiled into a verify criterion.
   */
  learn = async (params: {
    /** Where the domain is mounted: the goal's project, else its executing agent, else the user. */
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
    const scope = params.planSkill
      ? `the batch plan ${planSkillIdentifier(params.planSkill)}`
      : `the batch of "${params.goalTitle}"`;
    const domainId =
      params.domainId ??
      (await expertise.createDomain({
        brief: `What the release gate of ${scope} has learned.`,
        carrier: params.carrier,
        domainFilter: `Doing or verifying a unit of ${scope}.`,
        title: oneLine(`${params.goalTitle} · batch`, MAX_TITLE),
      }));

    const title = oneLine(params.guidance, MAX_TITLE);
    const lesson = await expertise.createRule({
      compilability: 'compilable',
      domainId,
      enforcement: 'block',
      how: params.guidance,
      title,
      why: `The release gate of round ${params.revision} sent the batch back: ${params.found}`,
    });
    if (!lesson) return undefined;

    const [criterionId] = await new VerifyPlanGeneratorService(
      this.db,
      this.userId,
      this.workspaceId,
    ).createCriteriaFromDrafts([
      {
        description: params.guidance,
        instruction: `PASS only when this unit's delivery follows the rule the batch learned at round ${params.revision}: ${params.guidance}`,
        onFail: 'manual',
        required: true,
        title,
        verifierType: 'agent',
      },
    ]);
    if (criterionId) {
      await expertise.updateLessonFields(lesson.id, {
        compilability: 'compiled',
        compiledCriterionId: criterionId,
      });
    }

    return {
      domainId,
      learning: {
        criterionId,
        lessonCode: lesson.code,
        lessonId: lesson.id,
        revision: params.revision,
        title,
      },
    };
  };
}
