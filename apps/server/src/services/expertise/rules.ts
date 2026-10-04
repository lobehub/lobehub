import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainExpertiseRuleDirection,
  chainExpertiseRuleDraft,
  chainExpertiseRuleGroupDraft,
  EXPERTISE_RULE_DIRECTION_JSON_SCHEMA,
  EXPERTISE_RULE_DIRECTION_PROMPT_VERSION,
  EXPERTISE_RULE_DRAFT_JSON_SCHEMA,
  EXPERTISE_RULE_DRAFT_PROMPT_VERSION,
  EXPERTISE_RULE_GROUP_DRAFT_JSON_SCHEMA,
  EXPERTISE_RULE_GROUP_DRAFT_PROMPT_VERSION,
} from '@lobechat/prompts';
import { EXPERTISE_RULE_DIRECTIONS, RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveExpertiseModelConfig } from './modelConfig';

const nullableText = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null);

export const RuleDraftSchema = z.object({
  // A draft can at most be checkable by a program; `compiled` means a criterion is linked, which
  // only the compiler does. Older prompt versions may still say `compiled`.
  compilability: z
    .enum(['compiled', 'compilable', 'not-compilable'])
    .transform((value) => (value === 'compiled' ? 'compilable' : value)),
  direction: z.enum(EXPERTISE_RULE_DIRECTIONS),
  enforcement: z.enum(['block', 'remind']),
  groupId: z.string().nullable(),
  how: nullableText,
  limits: nullableText,
  newGroup: z.object({ gate: z.string().min(1), title: z.string().min(1).max(60) }).nullable(),
  title: z.string().min(1).max(200),
  why: nullableText,
});

export const RuleGroupDraftSchema = z.object({
  gate: z.string().min(1),
  outOfScope: nullableText,
  title: z.string().min(1).max(60),
});

const RuleDirectionsSchema = z.object({
  rules: z.array(z.object({ direction: z.enum(EXPERTISE_RULE_DIRECTIONS), id: z.string() })),
});

/**
 * How many unjudged rules one call settles. Titles are a sentence each, so a batch this size is
 * one small request; the page asks again while any remain.
 */
export const RULE_DIRECTION_BATCH = 40;

export type RuleDraft = z.infer<typeof RuleDraftSchema>;
export type RuleGroupDraft = z.infer<typeof RuleGroupDraftSchema>;

/**
 * What the compose box sends: the sentence plus every group the page shows, so the model can
 * file the draft into one of them. The group list is not capped — group creation has no limit
 * and the page lists them all, so a cap here would turn every draft in a long-lived scope into a
 * failure.
 */
export const DraftRuleInputSchema = z.object({
  brief: z.string().min(1).max(20_000),
  groups: z.array(z.object({ gate: z.string(), id: z.string(), title: z.string() })),
});

export type DraftRuleInput = z.infer<typeof DraftRuleInputSchema>;

/**
 * Turns what the reviewer typed or pasted into an editable draft, and nothing else: no row is
 * written until they have seen every field and pressed save. A draft that names a group the
 * reviewer does not have is a model slip, not a request, so it is dropped to "no group".
 */
export class ExpertiseRuleDraftService {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  draftRule = async (input: DraftRuleInput): Promise<RuleDraft> => {
    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const draft = RuleDraftSchema.parse(
      await ai.generateObject(
        {
          ...chainExpertiseRuleDraft(input),
          ...modelConfig,
          schema: EXPERTISE_RULE_DRAFT_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.Expertise },
          tracing: {
            promptVersion: EXPERTISE_RULE_DRAFT_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ExpertiseRuleDraft,
            schemaName: EXPERTISE_RULE_DRAFT_JSON_SCHEMA.name,
          },
        },
      ),
    );

    const known = new Set(input.groups.map((group) => group.id));
    const groupId = draft.groupId && known.has(draft.groupId) ? draft.groupId : null;
    return { ...draft, groupId, newGroup: groupId ? null : draft.newGroup };
  };

  /**
   * Judges the direction of the next batch of active rules on the reviewer's page that have none,
   * and writes it. Ids the model returns that were not in the batch are dropped, so a slip can
   * only ever touch rules this reviewer can see. Resolves to how many it settled and how many
   * are still waiting, so the caller knows whether to ask again.
   */
  judgeDirections = async (): Promise<{ judged: number; remaining: number }> => {
    const model = new ExpertiseModel(this.db, this.userId, this.workspaceId);
    const groups = await model.listRules();
    const unjudged = groups
      .flatMap((group) => group.rules)
      .filter((rule) => rule.status === 'active' && !rule.direction);
    const batch = unjudged.slice(0, RULE_DIRECTION_BATCH);
    if (batch.length === 0) return { judged: 0, remaining: 0 };

    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const { rules } = RuleDirectionsSchema.parse(
      await ai.generateObject(
        {
          ...chainExpertiseRuleDirection({
            rules: batch.map((rule) => ({ id: rule.id, title: rule.title })),
          }),
          ...modelConfig,
          schema: EXPERTISE_RULE_DIRECTION_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.Expertise },
          tracing: {
            promptVersion: EXPERTISE_RULE_DIRECTION_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ExpertiseRuleDirection,
            schemaName: EXPERTISE_RULE_DIRECTION_JSON_SCHEMA.name,
          },
        },
      ),
    );

    // First answer per id wins; ids outside the batch are dropped.
    const judgedById = new Map<string, (typeof rules)[number]>();
    for (const rule of rules) {
      if (batch.some(({ id }) => id === rule.id) && !judgedById.has(rule.id))
        judgedById.set(rule.id, rule);
    }
    const judged = [...judgedById.values()];
    await model.fillLessonDirections(judged);
    return { judged: judged.length, remaining: unjudged.length - judged.length };
  };

  draftRuleGroup = async (input: { brief: string }): Promise<RuleGroupDraft> => {
    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    return RuleGroupDraftSchema.parse(
      await ai.generateObject(
        {
          ...chainExpertiseRuleGroupDraft(input),
          ...modelConfig,
          schema: EXPERTISE_RULE_GROUP_DRAFT_JSON_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.Expertise },
          tracing: {
            promptVersion: EXPERTISE_RULE_GROUP_DRAFT_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ExpertiseRuleGroupDraft,
            schemaName: EXPERTISE_RULE_GROUP_DRAFT_JSON_SCHEMA.name,
          },
        },
      ),
    );
  };
}
