import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainExpertiseRuleDraft,
  chainExpertiseRuleGroupDraft,
  EXPERTISE_RULE_DRAFT_JSON_SCHEMA,
  EXPERTISE_RULE_DRAFT_PROMPT_VERSION,
  EXPERTISE_RULE_GROUP_DRAFT_JSON_SCHEMA,
  EXPERTISE_RULE_GROUP_DRAFT_PROMPT_VERSION,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveExpertiseModelConfig } from './modelConfig';

const nullableText = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null);

export const RuleDraftSchema = z.object({
  compilability: z.enum(['compiled', 'compilable', 'not-compilable']),
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

export type RuleDraft = z.infer<typeof RuleDraftSchema>;
export type RuleGroupDraft = z.infer<typeof RuleGroupDraftSchema>;

export interface DraftRuleInput {
  brief: string;
  groups: { gate: string; id: string; title: string }[];
}

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
