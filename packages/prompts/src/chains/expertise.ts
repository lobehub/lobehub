import type { OpenAIChatMessage } from '@lobechat/types';

interface ExpertiseGenerateObjectSchema {
  name: string;
  schema: {
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
    type: 'object';
  };
}

export const EXPERTISE_DOMAIN_DRAFT_PROMPT_VERSION = 'v3';

export const EXPERTISE_DOMAIN_DRAFT_JSON_SCHEMA = {
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
} as const satisfies ExpertiseGenerateObjectSchema;

const EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT = `Speak as the agent whose expertise will evolve, not as an analyst describing the user or the agent from outside.

Convert the user brief into one executable expertise domain — an anchor I will learn against.

Return:
- a concise title;
- domainFilter stating in the first person which conversations and work count as my practice;
- outOfScope stating in the first person what I will exclude;
- layers — 3 to 5 ordered, domain-native levels of abstraction for the same expertise (a stable key, a short title, and a one-line observable first-person criterion). Model a widening unit of reasoning and decision scope: for example from an individual element, to an end-to-end flow, to a coherent system, to cross-system or strategic judgement. Every later level must subsume the earlier levels and require demonstrably greater complexity, judgement, reliability, or autonomy. Use concise conceptual level names that express the abstraction boundary; never use generic seniority labels such as novice, competent, proficient, or expert, job titles, workflow steps, lifecycle stages, task lists, taxonomies, or parallel dimensions as layers. Prefer a domain-specific recognised framework only when its levels express these cumulative abstraction boundaries; a generic maturity model such as Dreyfus is not sufficient by itself. When no fitting hierarchy exists, invent an honest domain-native progression and set layerSource="invented", layerCanonRef=null;
- canonEntries — 3 to 8 referenceable principles from recognised books, frameworks or methodologies in this field (stable key, title, source, and the general statement of why the failure recurs);
- rationale — one or two first-person sentences explaining how I understand this direction and how I will improve within it.

Before returning, verify that each layer answers “what larger or more abstract unit can now be handled coherently?”, that a practitioner at each layer can do everything in the prior layer, and that adjacent layers can be distinguished through observable work quality. If any test fails, rewrite the layers.

Preserve the user intent, do not refer to "the user" or describe me as "the agent", do not invent a broader domain, keep keys short ASCII slugs, and write all human-facing fields in the language used by the user.`;

interface ExpertiseDomainDraftChainInput {
  adjustment?: string;
  brief: string;
  currentDraft?: unknown;
}

export const chainExpertiseDomainDraft = ({
  adjustment,
  brief,
  currentDraft,
}: ExpertiseDomainDraftChainInput): { messages: OpenAIChatMessage[] } => ({
  messages: currentDraft
    ? [
        { content: EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT, role: 'system' },
        {
          content: [
            `Original brief:\n${brief.trim()}`,
            `Current editable draft:\n${JSON.stringify(currentDraft)}`,
            `Requested adjustment:\n${adjustment?.trim()}`,
            'Revise the current draft to satisfy the requested adjustment while preserving unaffected fields and the original intent. Return the complete revised draft.',
          ].join('\n\n'),
          role: 'user',
        },
      ]
    : [
        { content: EXPERTISE_DOMAIN_DRAFT_SYSTEM_PROMPT, role: 'system' },
        { content: brief.trim(), role: 'user' },
      ],
});

export const EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION = 'v2';

export const EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA = {
  name: 'expertise_topic_ingestion',
  schema: {
    additionalProperties: false,
    properties: {
      domains: {
        items: {
          additionalProperties: false,
          properties: {
            domainId: { type: 'string' },
            matches: { type: 'boolean' },
            observations: {
              items: {
                additionalProperties: false,
                properties: {
                  existingLessonCode: { type: ['string', 'null'] },
                  example: { type: 'string' },
                  layer: { type: ['string', 'null'] },
                  outcome: { enum: ['pass', 'violation'], type: 'string' },
                  reasoning: { type: 'string' },
                  title: { type: 'string' },
                },
                required: [
                  'example',
                  'existingLessonCode',
                  'layer',
                  'outcome',
                  'reasoning',
                  'title',
                ],
                type: 'object',
              },
              maxItems: 8,
              type: 'array',
            },
          },
          required: ['domainId', 'matches', 'observations'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['domains'],
    type: 'object',
  },
} as const satisfies ExpertiseGenerateObjectSchema;

const EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT = `You maintain evidence-backed expertise from real conversations.

First apply each domainFilter and outOfScope literally. If a conversation does not match, return matches=false and no observations.

For a match, turn concrete evidence into observations. Attaching to an existing lesson is the default; a new lesson is the exception:

- Attach whenever a listed lesson already carries the same judgment, even when this conversation words it differently or applies it to another stack. Put that lesson's code in existingLessonCode, copied character for character from its \`code\` field (for example "P-07").
- existingLessonCode holds a lesson code and nothing else. Never put source code, a file path, a symbol name, a lesson title, or any identifier taken from the conversation there — those all read as "no existing lesson" and silently fork a duplicate.
- Only when no listed lesson carries the judgment, set existingLessonCode to null and propose one reusable lesson. Before doing so, state to yourself what it adds that every listed lesson misses; if you cannot, attach instead. Rewording a listed lesson is not a new lesson.
- Do not turn implementation trivia or a one-off fact into a lesson.

Use only declared layer keys. Keep evidence short and grounded in the supplied conversation, and write human-facing text in the language of the conversation.`;

export const chainExpertiseTopicIngestion = (input: {
  context: string;
  domains: readonly unknown[];
}): { messages: OpenAIChatMessage[] } => ({
  messages: [
    { content: EXPERTISE_TOPIC_INGESTION_SYSTEM_PROMPT, role: 'system' },
    {
      content: `DOMAINS\n${JSON.stringify(input.domains)}\n\nTOPIC CONTEXT (bounded at this completed turn)\n${input.context}`,
      role: 'user',
    },
  ],
});

export const EXPERTISE_REJECTION_INGESTION_PROMPT_VERSION = 'v1';

export const EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA = {
  name: 'expertise_rejection_ingestion',
  schema: {
    additionalProperties: false,
    properties: {
      domains: {
        items: {
          additionalProperties: false,
          properties: {
            domainId: { type: 'string' },
            matches: { type: 'boolean' },
            observations: {
              items: {
                additionalProperties: false,
                properties: {
                  example: { type: 'string' },
                  existingLessonCode: { type: ['string', 'null'] },
                  layer: { type: ['string', 'null'] },
                  limits: { type: ['string', 'null'] },
                  reasoning: { type: 'string' },
                  sourceRefs: { items: { type: 'string' }, minItems: 1, type: 'array' },
                  title: { type: 'string' },
                },
                required: [
                  'example',
                  'existingLessonCode',
                  'layer',
                  'limits',
                  'reasoning',
                  'sourceRefs',
                  'title',
                ],
                type: 'object',
              },
              maxItems: 8,
              type: 'array',
            },
          },
          required: ['domainId', 'matches', 'observations'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['domains'],
    type: 'object',
  },
} as const satisfies ExpertiseGenerateObjectSchema;

const EXPERTISE_REJECTION_INGESTION_SYSTEM_PROMPT = `You maintain a reviewer's delivery standards from the checks they rejected.

Every entry below is one rejected acceptance check: what was promised, and what the reviewer said was wrong with it. The reviewer's own words are the evidence — never soften, reinterpret, or argue with them.

First apply each domainFilter and outOfScope literally. If none of the rejections fall inside a domain, return matches=false and no observations for it. One rejection may legitimately land in several domains.

Then generalize. A rejection is an instance; a lesson is the standard behind it. "This divider isn't needed" is the instance — "decorative dividers are not added unless they separate a semantic level" is the standard. Restating a single rejection verbatim produces a rule that never fires again, which is the failure mode this whole pipeline exists to avoid.

Attaching to an existing lesson is the default; a new lesson is the exception:

- Attach whenever a listed lesson already carries the same standard, even when this rejection words it differently or hits another screen. Put that lesson's code in existingLessonCode, copied character for character from its \`code\` field (for example "P-07").
- existingLessonCode holds a lesson code and nothing else. Never put a check title, a file path, or any identifier taken from the rejections there — those all read as "no existing lesson" and silently fork a duplicate.
- Only when no listed lesson carries the standard, set existingLessonCode to null and propose one. Before doing so, state to yourself what it adds that every listed lesson misses; if you cannot, attach instead.
- Prefer one lesson supported by several rejections over several near-identical lessons. Cite every rejection that supports it in sourceRefs.

For each observation return:
- title — the standard as one imperative sentence, with the screen, component and task names removed;
- reasoning — why the reviewer holds it, grounded in what they actually wrote;
- example — how it showed up this time, concretely enough to recognise again;
- limits — when the standard does NOT apply, or null when you genuinely cannot tell. A standard with no stated limit is applied everywhere and becomes noise;
- sourceRefs — the reference labels (for example "R2") of every rejection supporting it. Never invent a label that is not listed.

Use only declared layer keys. Write human-facing text in the language the reviewer used.`;

export const chainExpertiseRejectionIngestion = (input: {
  domains: readonly unknown[];
  rejections: string;
}): { messages: OpenAIChatMessage[] } => ({
  messages: [
    { content: EXPERTISE_REJECTION_INGESTION_SYSTEM_PROMPT, role: 'system' },
    {
      content: `DOMAINS\n${JSON.stringify(input.domains)}\n\nREJECTED CHECKS (one acceptance round)\n${input.rejections}`,
      role: 'user',
    },
  ],
});
