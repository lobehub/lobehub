import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainExpertiseDomainDraft,
  EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA,
  EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION,
} from '@lobechat/prompts';
import { z } from 'zod';

import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveExpertiseModelConfig } from './modelConfig';

const LayerSchema = z.object({
  description: z.string().nullable(),
  key: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
});
const CanonEntrySchema = z.object({
  key: z.string().min(1).max(40),
  source: z.string().min(1).max(120),
  statement: z.string().min(1),
  title: z.string().min(1).max(80),
});

export const EditableDomainDraftSchema = z.object({
  canonEntries: z
    .array(
      z.object({
        key: z.string().max(2000),
        source: z.string().max(2000),
        statement: z.string().max(10_000),
        title: z.string().max(2000),
      }),
    )
    .max(20),
  domainFilter: z.string().max(10_000),
  layerCanonRef: z.string().max(2000).nullable(),
  layerSource: z.enum(['canonical', 'invented']),
  layers: z
    .array(
      z.object({
        description: z.string().max(10_000).nullable(),
        key: z.string().max(2000),
        title: z.string().max(2000),
      }),
    )
    .max(20),
  outOfScope: z.string().max(10_000).nullable(),
  rationale: z.string().max(10_000).nullable(),
  title: z.string().max(2000),
});

/**
 * A draft is a full anchor candidate, not just a name and a filter: the layer model and the
 * canon decide where lessons attach and what "coverage" even means, so the person creating a
 * direction must be able to see and edit them before anything is persisted.
 */
export const DomainDraftSchema = z.object({
  canonEntries: z.array(CanonEntrySchema).max(8),
  domainFilter: z.string().min(1),
  layerCanonRef: z.string().nullable(),
  layerSource: z.enum(['canonical', 'invented']),
  layers: z.array(LayerSchema).max(6),
  outOfScope: z.string().nullable(),
  rationale: z.string().nullable(),
  title: z.string().min(1).max(80),
});
export type DomainDraft = z.infer<typeof DomainDraftSchema>;
export type EditableDomainDraft = z.infer<typeof EditableDomainDraftSchema>;

interface DraftFromBriefInput {
  adjustment?: string;
  agentId: string;
  brief: string;
  currentDraft?: EditableDomainDraft;
}

export class ExpertiseDomainService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /** Turns one natural-language brief into an editable domain draft; nothing is persisted. */
  draftFromBrief = async (input: DraftFromBriefInput) => {
    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    return DomainDraftSchema.parse(
      await ai.generateObject(
        {
          ...chainExpertiseDomainDraft(input),
          ...modelConfig,
          schema: EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA,
        },
        {
          metadata: { trigger: 'expertise_domain_draft' },
          tracing: {
            agentId: input.agentId,
            promptVersion: EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.ExpertiseDomainDraft,
            schemaName: EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA.name,
          },
        },
      ),
    );
  };

  /** Persists a reviewed draft as the chosen anchor. The user has seen and possibly edited every field by now. */
  create = async (input: DomainDraft & { agentId: string; brief: string }) =>
    new ExpertiseModel(this.db, this.userId, this.workspaceId).createDomain({
      agentId: input.agentId,
      brief: input.brief,
      canonEntries: input.canonEntries,
      domainFilter: input.domainFilter,
      layerCanonRef: input.layerCanonRef ?? undefined,
      layers: input.layers.map((l) => ({
        canonRef: input.layerCanonRef ?? undefined,
        description: l.description ?? undefined,
        key: l.key,
        title: l.title,
      })),
      layerSource: input.layerSource,
      outOfScope: input.outOfScope ?? undefined,
      rationale: input.rationale ?? undefined,
      title: input.title,
    });

  /** One-shot path kept for callers that do not review the draft (tests, scripts). */
  createFromBrief = async (input: { agentId: string; brief: string }) => {
    const generated = await this.draftFromBrief(input);
    return this.create({ ...input, ...generated });
  };
}
