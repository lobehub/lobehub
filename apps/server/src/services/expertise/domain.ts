import { TRACING_SCENARIOS } from '@lobechat/const';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

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

const DOMAIN_DRAFT_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'expertise_domain_draft',
  schema: {
    additionalProperties: false,
    properties: {
      canonEntries: {
        items: {
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            source: { type: 'string' },
            statement: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['key', 'source', 'statement', 'title'],
          type: 'object',
        },
        maxItems: 8,
        type: 'array',
      },
      domainFilter: { type: 'string' },
      layerCanonRef: { type: ['string', 'null'] },
      layerSource: { enum: ['canonical', 'invented'], type: 'string' },
      layers: {
        items: {
          additionalProperties: false,
          properties: {
            description: { type: ['string', 'null'] },
            key: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['description', 'key', 'title'],
          type: 'object',
        },
        maxItems: 6,
        type: 'array',
      },
      outOfScope: { type: ['string', 'null'] },
      rationale: { type: ['string', 'null'] },
      title: { maxLength: 80, type: 'string' },
    },
    required: [
      'canonEntries',
      'domainFilter',
      'layerCanonRef',
      'layerSource',
      'layers',
      'outOfScope',
      'rationale',
      'title',
    ],
    type: 'object',
  },
};

const DRAFT_SYSTEM_PROMPT = [
  'Convert the user brief into one executable expertise domain — an anchor the agent will learn against.',
  'Return: a concise title; domainFilter stating which conversations and work count as practice; outOfScope stating explicit exclusions;',
  'layers — 3 to 5 ordered, domain-native levels of abstraction for the same expertise (a stable key, a short title, and a one-line observable criterion). Model a widening unit of reasoning and decision scope: for example from an individual element, to an end-to-end flow, to a coherent system, to cross-system or strategic judgement. Every later level must subsume the earlier levels and require demonstrably greater complexity, judgement, reliability, or autonomy. Use concise conceptual level names that express the abstraction boundary; never use generic seniority labels such as novice, competent, proficient, or expert, job titles, workflow steps, lifecycle stages, task lists, taxonomies, or parallel dimensions as layers. Prefer a domain-specific recognised framework only when its levels express these cumulative abstraction boundaries; a generic maturity model such as Dreyfus is not sufficient by itself. When no fitting hierarchy exists, invent an honest domain-native progression and set layerSource="invented", layerCanonRef=null;',
  'canonEntries — 3 to 8 referenceable principles from recognised books, frameworks or methodologies in this field (stable key, title, source, and the general statement of why the failure recurs);',
  'rationale — one or two sentences on why this anchor fits the brief.',
  'Before returning, verify that each layer answers “what larger or more abstract unit can now be handled coherently?”, that a practitioner at each layer can do everything in the prior layer, and that adjacent layers can be distinguished through observable work quality. If any test fails, rewrite the layers.',
  'Preserve the user intent, do not invent a broader domain, keep keys short ASCII slugs, and write all human-facing fields in the language used by the user.',
].join(' ');

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
    const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
    const modelConfig = await agentModel.getAgentModelConfig(input.agentId);
    if (!modelConfig) throw new Error('Agent model configuration is unavailable');

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    return DomainDraftSchema.parse(
      await ai.generateObject(
        {
          messages: input.currentDraft
            ? [
                { content: DRAFT_SYSTEM_PROMPT, role: 'system' },
                {
                  content: [
                    `Original brief:\n${input.brief.trim()}`,
                    `Current editable draft:\n${JSON.stringify(input.currentDraft)}`,
                    `Requested adjustment:\n${input.adjustment?.trim()}`,
                    'Revise the current draft to satisfy the requested adjustment while preserving unaffected fields and the original intent. Return the complete revised draft.',
                  ].join('\n\n'),
                  role: 'user',
                },
              ]
            : [
                { content: DRAFT_SYSTEM_PROMPT, role: 'system' },
                { content: input.brief.trim(), role: 'user' },
              ],
          ...modelConfig,
          schema: DOMAIN_DRAFT_JSON_SCHEMA,
        },
        {
          metadata: { trigger: 'expertise_domain_draft' },
          tracing: {
            agentId: input.agentId,
            promptVersion: 'expertise-domain-draft-v3',
            scenario: TRACING_SCENARIOS.TopicAutoSummary,
            schemaName: DOMAIN_DRAFT_JSON_SCHEMA.name,
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
