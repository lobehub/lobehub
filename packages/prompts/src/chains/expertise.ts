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
                  // Whether the standard rests on something observable or on the owner's
                  // preference. Orthogonal to `reasonSource` (who supplied the reason) and load
                  // bearing downstream: a taste standard has no objective test, so it must not be
                  // compiled into a criterion that blocks a delivery on its own.
                  reasonKind: { enum: ['mechanism', 'taste'], type: 'string' },
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
                  'reasonKind',
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
- reasonKind — "mechanism" when the reason above survives that transfer test, "taste" when it does not. Not every standard has a mechanism underneath it, and that is legitimate: some of what a reviewer requires is simply what they prefer. Use your own failure as the detector — if the only reason you can produce is a synonym of the objection ("untidy", "visual noise", "inelegant", "not clean"), stop trying and answer "taste".

  For "taste", do not dress the verdict up. State the preference plainly and in a form the next delivery can act on: "the owner does not accept dividers that were not asked for; regions are separated by spacing and container edges alone" is a complete and honest reason. A fabricated mechanism is worse than an admitted preference, because it reads as objective and gets enforced as if it were;
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

export const EXPERTISE_CONSOLIDATION_PROMPT_VERSION = 'v2';

export const EXPERTISE_CONSOLIDATION_JSON_SCHEMA = {
  name: 'expertise_consolidation',
  schema: {
    additionalProperties: false,
    properties: {
      // `false` is a real answer, not a failure: instances that only share a category do not
      // share a standard, and rewriting them into one invents a rule nobody stated.
      generalized: { type: 'boolean' },
      // Structured rather than one `limits` sentence, because a boundary is only legitimate if it
      // can name what it rests on. The service resolves every ref to a check result id and drops
      // any entry that resolves to nothing — which turns "never invent an exemption" from a request
      // into something enforced.
      limits: {
        items: {
          additionalProperties: false,
          properties: {
            // A limit the reviewer already stated on the current standard, carried over. Checked
            // against the current text, so it cannot smuggle in a new exemption.
            keptFromCurrent: { type: 'boolean' },
            shippedRefs: { items: { type: 'string' }, type: 'array' },
            text: { type: 'string' },
          },
          required: ['keptFromCurrent', 'shippedRefs', 'text'],
          type: 'object',
        },
        type: 'array',
      },
      // Plain strings rather than nullable unions — the pinned model answers a nullable under a
      // strict schema with `{}`, which fails the parse and loses the pass.
      note: { type: 'string' },
      reasonKind: { enum: ['mechanism', 'taste'], type: 'string' },
      reasoning: { type: 'string' },
      subject: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['generalized', 'limits', 'note', 'reasonKind', 'reasoning', 'subject', 'title'],
    type: 'object',
  },
} as const satisfies ExpertiseGenerateObjectSchema;

const EXPERTISE_CONSOLIDATION_SYSTEM_PROMPT = `You are rewriting one delivery standard now that the reviewer has rejected several deliveries for it.

The standard in front of you was written from a single rejection, so it is worded at the level of the screen that rejection happened on. Every instance since then attached to it because it said the same thing. Your job is to restate it at the level all of those instances actually share — and to give it the boundary it has never had.

INSTANCES are the deliveries the reviewer rejected under this standard: what was promised, what they said was wrong, and the frame they circled. SHIPPED are deliveries the same reviewer accepted, with their frames. Read the frames; a standard rewritten from the text alone is a summary of complaints, not a standard.

## Restating it

State the standard so that every instance is an example of it, and nothing is smuggled in that only one instance supports. Two failures to avoid, in both directions:

- Too low: the sentence still names a screen, a component or a feature from one instance. A standard that only fires again on that screen is the instance wearing a rule's clothes.
- Too high: the sentence would also condemn deliveries the reviewer never objected to. Each climb has to be paid for by an instance — if only one instance supports the wider wording, the wider wording is yours, not theirs.

If the instances do not share a standard, answer \`generalized\`: false and return the current wording unchanged. This is the common case for placement and ordering complaints: "put the status next to the title" and "move topics above the profile" are both about position and are not the same rule. Say so in \`note\` and stop. A rewrite that unites unrelated instances is worse than no rewrite, because it starts firing on everything.

## The boundary

\`limits\` is the one thing you could not write from a single rejection, and SHIPPED is what makes it writable now.

Look for a shipped delivery whose frame plainly shows this standard's subject, in the state the standard objects to — and which the reviewer accepted anyway. That is a boundary the reviewer drew with their own hands: the standard stops somewhere before that delivery. Write it as where the standard stops, pointing at what is different about the case they let through.

Return \`limits\` as a list. Each entry is one exemption:
- \`text\` — where the standard stops, in the reviewer's language.
- \`shippedRefs\` — the labels of the SHIPPED deliveries it was read from (for example ["S2"]). Every new exemption must name at least one. An entry that names none, or names an instance, is discarded — and so is any label that is not listed.
- \`keptFromCurrent\` — true only for a limit the reviewer already stated in the standard as it stands, which you are carrying over unchanged. Copy its wording; do not widen it. Never mark the placeholder "边界未由评审者说明" (in any language) as a limit.

Rules on this, in order:
- Only a shipped delivery whose frame you have actually read can justify a new exemption. Never infer one from the instances, from the standard's own wording, or from what a reasonable person "would obviously" exempt — an invented exemption silently narrows a standard the reviewer stated without limit.
- A limit the reviewer already stated stays. Dropping it widens the standard past what they said, which is the same failure in the other direction.
- If the shipped frames do not show the subject at all, you have learned nothing about the boundary: return only the limits you are carrying over (often none), and do not apologise for it in \`note\`.
- If a shipped delivery shows the subject in the objectionable state and you cannot tell what makes it different, say that in \`note\` and add no entry for it. "I cannot see the distinction" is information; a guessed distinction is not.

## The rest

- \`subject\` — what the standard is about once the concrete names are replaced by what they exemplify. It has to cover every instance.
- \`reasoning\` — the MECHANISM: which property of the delivery causes what concrete consequence, and for whom. Judge your own sentence by whether someone facing a case none of these instances describe could settle it using your reason alone. "Harms tidiness", "adds visual noise", "feels inconsistent" are verdicts wearing a reason's clothes — the tidiness is the very judgement in question. Replace them with what a person fails to see, misreads, mis-clicks, or has to do twice.
- \`reasonKind\` — "mechanism" if that reason survives the transfer test, "taste" if the only reason you can produce is a synonym of the objection. Several instances make this easier to settle honestly, not harder: if the reviewer has rejected the same thing four times and you still cannot name a consequence, it is taste, and saying so plainly is the useful answer.
- \`note\` — one sentence for the reviewer on what changed and what carried it, naming the instances. This is read by a person deciding whether to trust the rewrite.

Write human-facing text in the language the reviewer used.`;

export const chainExpertiseConsolidation = (input: {
  /** The deliveries rejected under this standard, each labelled with the frame it circled. */
  instances: string;
  lesson: string;
  /** Deliveries the reviewer accepted — the only evidence that can justify a limit. */
  shipped: string;
  visuals?: { accessUrl: string; label: string }[];
  /** Frames left out, stated so their absence does not read as proof the subject is not there. */
  withheldEvidence?: string;
}): { messages: OpenAIChatMessage[] } => {
  const visuals = input.visuals ?? [];
  const frameList = visuals.length
    ? visuals.map((visual, index) => `  [frame ${index + 1}] ${visual.label}`).join('\n')
    : '  (none)';

  const text = [
    `STANDARD AS IT STANDS\n${input.lesson}`,
    `\nINSTANCES (rejected under it)\n${input.instances}`,
    `\nSHIPPED (accepted by the same reviewer)\n${input.shipped || '  (none available)'}`,
    `\nATTACHED FRAMES (in order)\n${frameList}`,
    input.withheldEvidence ? `\nWITHHELD FROM THIS REQUEST\n${input.withheldEvidence}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    messages: [
      { content: EXPERTISE_CONSOLIDATION_SYSTEM_PROMPT, role: 'system' },
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
