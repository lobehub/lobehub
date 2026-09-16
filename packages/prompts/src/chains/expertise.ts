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

export const EXPERTISE_REJECTION_INGESTION_PROMPT_VERSION = 'v3';

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
                  // Plain strings, not `['string', 'null']` unions: under a strict json_schema the
                  // pinned model answers a nullable union with `{}`, which fails the parse and
                  // loses the whole round. An empty string is the "none" the service reads.
                  existingLessonCode: { type: 'string' },
                  layer: { type: 'string' },
                  limits: { type: 'string' },
                  reasoning: { type: 'string' },
                  // Self-classified provenance. The model may explain the mechanism — that is what
                  // makes a standard transferable — but an explanation it invented must never read
                  // as something the reviewer stated.
                  reasonSource: { enum: ['reviewer', 'inferred'], type: 'string' },
                  sourceRefs: { items: { type: 'string' }, minItems: 1, type: 'array' },
                  // Naming the abstracted subject is what forces the climb: a model that cannot
                  // say what the concrete thing is an example of has not generalized at all.
                  subject: { type: 'string' },
                  title: { type: 'string' },
                },
                required: [
                  'example',
                  'existingLessonCode',
                  'layer',
                  'limits',
                  'reasonSource',
                  'reasoning',
                  'sourceRefs',
                  'subject',
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

Every entry below is one rejected acceptance check: what was promised, what the reviewer said was wrong with it, and — when they circled a region on a screenshot — the screenshot itself. The reviewer's own words are the evidence; never soften, reinterpret, or argue with them.

Most of these rejections are visual. "This isn't aligned", "this is too big", "the colour is too heavy" cannot be understood from text alone: read the attached frame, find the circled region, and describe what is actually wrong there. A standard written without looking at the frame is a paraphrase of a complaint, not a standard.

First apply each domainFilter and outOfScope literally. If none of the rejections fall inside a domain, return matches=false and no observations for it. One rejection may legitimately land in several domains.

Then generalize, and check how far you got. A rejection is an instance; a lesson is the standard behind it. Restating one rejection verbatim produces a rule that never fires again, which is the failure mode this whole pipeline exists to avoid — but stripping the screen name out of a sentence is not generalizing either.

Apply this test to every title before you return it: could a delivery on a completely unrelated screen violate this standard? If the answer is no, you are still describing the instance. Climb one level: replace the concrete things with what they are an example of, and say it in \`subject\` — "the reaction buttons under a comment" is really "a set of results plus a control that adds to it"; "the annotation border on a screenshot" is really "a thin line drawn over user content".

Do not climb past what the reviewer actually objected to. If they rejected one decorative divider, the standard is about decoration that was not asked for — not about dividers in text inputs, and not about every visual element on the page.

Attaching to an existing lesson is the default; a new lesson is the exception:

- Attach whenever a listed lesson already carries the same standard, even when this rejection words it differently or hits another screen. Put that lesson's code in existingLessonCode, copied character for character from its \`code\` field (for example "P-07").
- existingLessonCode holds a lesson code and nothing else. Never put a check title, a file path, or any identifier taken from the rejections there — those all read as "no existing lesson" and silently fork a duplicate.
- Only when no listed lesson carries the standard, set existingLessonCode to "" and propose one. Before doing so, state to yourself what it adds that every listed lesson misses; if you cannot, attach instead.
- Prefer one lesson supported by several rejections over several near-identical lessons. Cite every rejection that supports it in sourceRefs.

For each observation return:
- title — the standard as one imperative sentence, stated about \`subject\` rather than about the screen it happened on;
- subject — what the standard is really about, once the concrete names are replaced by what they exemplify;
- reasoning — the MECHANISM: which property of the delivery causes what concrete consequence, and for whom. Name both halves. "A pale line has too little luminance difference from a white background, so the reader cannot tell which region was circled" names both; "the reviewer said the cyan is too light" is the evidence, not a reason, and it already lives elsewhere.

  The mechanism is what lets a standard transfer to a screen nobody has built yet, so judge your own sentence by exactly that: could someone facing a situation this round never described settle it using your reason alone? If not, you have not written a mechanism. Restating the objection in more flattering words always fails this test — "harms visual tidiness", "feels inelegant", "hurts consistency", "adds cognitive load" are verdicts wearing a reason's clothes, because tidiness and elegance are the very judgement in question. Replace every such phrase with the observable consequence underneath it: what does a person fail to see, misread, mis-click, or have to do twice?

  Write the mechanism even when the reviewer only pointed at something — that is what reasonSource is for;
- reasonSource — where that reason came from, decided by one test you can actually run: does the reviewer's own text state a consequence or a cause, not just an instruction? "the cyan is too light, I can't see it" states a consequence → "reviewer". "put it in one row, annotations left, actions right" and "there's an extra line here" are instructions with no cause → "inferred", however obvious the cause seems. So is "this is ugly" / "this is wrong" / "this doesn't work". When in doubt answer "inferred": over-claiming the reviewer said something is the one failure this field exists to prevent, and under-claiming costs nothing;
- example — how it showed up this time, concretely enough to recognise again;
- limits — the boundary THE REVIEWER drew. Fill it only when they said where the standard stops, or when another rejection in this same round contradicts it. Otherwise answer exactly "边界未由评审者说明" (or the same sentence in their language). An invented exemption is worse than an empty one: it silently narrows a standard the reviewer stated without limit;
- sourceRefs — the reference labels (for example "R2") of every rejection supporting it. Never invent a label that is not listed.

Leave existingLessonCode and layer as an empty string rather than null when they do not apply — never as an object. Use only declared layer keys. Write human-facing text in the language the reviewer used.`;

export const chainExpertiseRejectionIngestion = (input: {
  domains: readonly unknown[];
  rejections: string;
  /** Frames the reviewer circled, labelled so the text can point at them. */
  visuals?: { accessUrl: string; label: string }[];
  /** Frames left out of this request, stated so the model does not read their absence as proof. */
  withheldEvidence?: string;
}): { messages: OpenAIChatMessage[] } => {
  const visuals = input.visuals ?? [];
  const frameList = visuals.length
    ? visuals.map((visual, index) => `  [frame ${index + 1}] ${visual.label}`).join('\n')
    : '  (none)';

  const text = [
    `DOMAINS\n${JSON.stringify(input.domains)}`,
    `\nREJECTED CHECKS (one acceptance round)\n${input.rejections}`,
    `\nATTACHED FRAMES (in order)\n${frameList}`,
    input.withheldEvidence ? `\nWITHHELD FROM THIS REQUEST\n${input.withheldEvidence}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    messages: [
      { content: EXPERTISE_REJECTION_INGESTION_SYSTEM_PROMPT, role: 'system' },
      {
        content: visuals.length
          ? [
              { text, type: 'text' as const },
              ...visuals.map((visual) => ({
                image_url: { detail: 'high' as const, url: visual.accessUrl },
                type: 'image_url' as const,
              })),
            ]
          : text,
        role: 'user',
      },
    ],
  };
};
