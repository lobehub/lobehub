/**
 * Prompts and output schemas for memory consolidation. Calibrated on a 200-memory replay and a
 * full 1586-memory run (see the consolidation PR): a blind judge rated 91% of online placements
 * reasonable, and dossier coherence 4.7 / 5.
 */

const LANGUAGE_RULE = 'Write every title and summary in the language the memories are written in.';

export const CLASSIFY_SYSTEM = [
  "You are organizing one user's historical memories. Each memory was extracted from one conversation. Decide where each one goes:",
  '- evidence: progress on something that keeps moving across conversations (a project, a feature, a customer deal, fundraising, a negotiation), including single work sessions on it;',
  '- fact: a stable fact about a person, company or product (identity, relationship, renaming, positioning) that does not change as work moves on;',
  '- preference: a preference, habit or requirement of someone (usually the user, possibly a customer or investor);',
  '- drop: one-off technical Q&A, reading notes on papers or research, chit-chat, anything not tied to an ongoing matter.',
  'domain: a short key "area/direction" (e.g. product/task-system, customer/acme, company/fundraising); the same matter always gets the same key.',
  'entities: concrete people, companies, products, repositories mentioned (never "User").',
  'holder: for a preference, whose preference it is ("self" for the user).',
  'Return one item per input memory, keeping its id.',
].join('\n');

export const CLASSIFY_SCHEMA = {
  name: 'memory_consolidation_classify',
  schema: {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            domain: { type: 'string' },
            entities: { items: { type: 'string' }, type: 'array' },
            holder: { type: 'string' },
            id: { type: 'string' },
            route: { enum: ['evidence', 'fact', 'preference', 'drop'], type: 'string' },
            value: { enum: ['high', 'medium', 'low'], type: 'string' },
          },
          required: ['id', 'route', 'value', 'domain', 'entities', 'holder'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['items'],
    type: 'object' as const,
  },
  strict: true,
};

export const NORMALIZE_SYSTEM = [
  'Below are domain keys produced while classifying memories, with how many memories each has. Many are different spellings of the same domain or are split too finely.',
  'Merge them into one shared list: the same project direction, the same customer, the same company matter become one domain. Do not force different project directions together.',
  'Every raw key must map to exactly one unified key.',
].join('\n');

export const NORMALIZE_SCHEMA = {
  name: 'memory_consolidation_normalize',
  schema: {
    additionalProperties: false,
    properties: {
      mapping: {
        items: {
          additionalProperties: false,
          properties: { domain: { type: 'string' }, raw: { type: 'string' } },
          required: ['raw', 'domain'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['mapping'],
    type: 'object' as const,
  },
  strict: true,
};

export const SYNTHESIZE_SYSTEM = [
  "You organize one user's memories in one domain into two levels:",
  '- context (level 1): a project direction, a customer relationship or a company matter, e.g. "Task system", "Acme partnership", "Seed round". A domain usually has 1-3 contexts; do not split one project direction into several contexts.',
  '- dossier (level 2): one feature, one deal or one ongoing sub-task inside a context, e.g. "Task scheduler backend (heartbeat/cron)", "Bridge loan". A dossier usually spans many conversations: every session of developing, fixing, reviewing or rebasing the same feature belongs to that one dossier. Do not split dossiers by session, by PR or by single bug. Only memories unrelated to all others get a dossier of their own.',
  'Every memory goes into exactly one dossier (members are memory ids), or into "unplaced" when it has nothing to do with the ongoing matters of this domain.',
  'When an existing structure is given (built from earlier memories), file memories that belong to an existing dossier with existing_dossier set to that dossier id, and keep an existing context with existing_context set to its id. Do not open duplicates.',
  '"now": where the matter stands now, from the newest memories, one or two sentences. next_steps / open_questions: only what the memories state explicitly.',
  LANGUAGE_RULE,
].join('\n');

export const SYNTHESIZE_SCHEMA = {
  name: 'memory_consolidation_synthesize',
  schema: {
    additionalProperties: false,
    properties: {
      contexts: {
        items: {
          additionalProperties: false,
          properties: {
            dossiers: {
              items: {
                additionalProperties: false,
                properties: {
                  existing_dossier: { type: 'string' },
                  members: { items: { type: 'string' }, type: 'array' },
                  now: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['existing_dossier', 'title', 'now', 'members'],
                type: 'object',
              },
              type: 'array',
            },
            existing_context: { type: 'string' },
            next_steps: { items: { type: 'string' }, type: 'array' },
            now: { type: 'string' },
            open_questions: { items: { type: 'string' }, type: 'array' },
            title: { type: 'string' },
          },
          required: [
            'existing_context',
            'title',
            'now',
            'next_steps',
            'open_questions',
            'dossiers',
          ],
          type: 'object',
        },
        type: 'array',
      },
      unplaced: { items: { type: 'string' }, type: 'array' },
    },
    required: ['contexts', 'unplaced'],
    type: 'object' as const,
  },
  strict: true,
};

export const ROUTE_SYSTEM = [
  "You maintain one user's memory. Structure: context (a project direction / customer relationship / company matter) -> dossier (one feature, deal or ongoing sub-task) -> evidence (progress from each conversation).",
  "A new memory extracted from a conversation arrives. First decide route: evidence (progress on something ongoing, including a single work session) / fact (a stable fact about a person or company) / preference (someone's preference or requirement) / drop (one-off technical Q&A, research notes, chit-chat).",
  'For evidence, pick the context it belongs to from the list (context = its id). Only when none is related, set context to "new" and give new_context_title. Work in the same project direction belongs to the same context; a new sub-feature is not a reason for a new context.',
  'confidence is how sure you are of the context choice (0-1).',
  LANGUAGE_RULE,
].join('\n');

export const ROUTE_SCHEMA = {
  name: 'memory_consolidation_route',
  schema: {
    additionalProperties: false,
    properties: {
      confidence: { type: 'number' },
      context: { type: 'string' },
      new_context_title: { type: 'string' },
      reason: { type: 'string' },
      route: { enum: ['evidence', 'fact', 'preference', 'drop'], type: 'string' },
    },
    required: ['route', 'context', 'new_context_title', 'confidence', 'reason'],
    type: 'object' as const,
  },
  strict: true,
};

export interface ClassifiedItem {
  domain: string;
  entities: string[];
  holder: string;
  id: string;
  route: 'drop' | 'evidence' | 'fact' | 'preference';
  value: 'high' | 'low' | 'medium';
}

export interface SynthesizedContext {
  dossiers: { existing_dossier: string; members: string[]; now: string; title: string }[];
  existing_context: string;
  next_steps: string[];
  now: string;
  open_questions: string[];
  title: string;
}

export interface SynthesisResult {
  contexts: SynthesizedContext[];
  unplaced: string[];
}

export interface RouteResult {
  confidence: number;
  context: string;
  new_context_title: string;
  reason: string;
  route: 'drop' | 'evidence' | 'fact' | 'preference';
}
