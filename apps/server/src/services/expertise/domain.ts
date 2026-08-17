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
  'layers — the 2 to 5 levels this expertise is judged on (a stable key, a short title, one-line description). Prefer a canonical layer model from a well-known framework in this field and name it in layerCanonRef with layerSource="canonical"; only invent layers (layerSource="invented", layerCanonRef=null) when no canonical model fits;',
  'canonEntries — 3 to 8 referenceable principles from recognised books, frameworks or methodologies in this field (stable key, title, source, and the general statement of why the failure recurs);',
  'rationale — one or two sentences on why this anchor fits the brief.',
  'Preserve the user intent, do not invent a broader domain, keep keys short ASCII slugs, and write all human-facing fields in the language used by the user.',
].join(' ');

export class ExpertiseDomainService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /** Turns one natural-language brief into an editable domain draft; nothing is persisted. */
  draftFromBrief = async (input: { agentId: string; brief: string }) => {
    const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
    const modelConfig = await agentModel.getAgentModelConfig(input.agentId);
    if (!modelConfig) throw new Error('Agent model configuration is unavailable');

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    return DomainDraftSchema.parse(
      await ai.generateObject(
        {
          messages: [
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
            promptVersion: 'expertise-domain-draft-v2',
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
