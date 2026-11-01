import type { OpenAIChatMessage } from '@lobechat/types';

/**
 * Bump when editing the builder-suggestion system prompt or schema below.
 * Plumbed through `tracing.promptVersion` at the call site so per-call tracing
 * groups runs by prompt iteration. The 6-char prompt hash on the row catches
 * forgotten bumps.
 */
export const BUILDER_SUGGESTION_PROMPT_VERSION = 'v1.0';

/**
 * Symbolic schema name — also recorded on the tracing row's `schemaName`
 * column so prompt iterations and schema renames can be reasoned about
 * together.
 */
export const BUILDER_SUGGESTION_SCHEMA_NAME = 'BuilderSuggestion';

/** Which builder surface the suggestions are generated for. */
export type BuilderSuggestionMode = 'agent' | 'group';

export interface BuilderSuggestionItem {
  /** Full instruction sent to the builder when the chip is clicked (<=200 chars). */
  prompt: string;
  /** Short chip label (<=40 chars). */
  title: string;
}

export interface BuilderSuggestionSchema {
  name: typeof BUILDER_SUGGESTION_SCHEMA_NAME;
  schema: {
    additionalProperties: false;
    properties: {
      suggestions: {
        items: {
          additionalProperties: false;
          properties: {
            prompt: { description: string; maxLength: 200; minLength: 1; type: 'string' };
            title: { description: string; maxLength: 40; minLength: 1; type: 'string' };
          };
          required: ['title', 'prompt'];
          type: 'object';
        };
        maxItems: 3;
        type: 'array';
      };
    };
    required: ['suggestions'];
    type: 'object';
  };
  strict: true;
}

const BUILDER_SUGGESTION_SCHEMA: BuilderSuggestionSchema = {
  name: BUILDER_SUGGESTION_SCHEMA_NAME,
  schema: {
    additionalProperties: false,
    properties: {
      suggestions: {
        items: {
          additionalProperties: false,
          properties: {
            prompt: {
              description:
                'The full message the user sends to the builder when the chip is clicked, phrased in the user\'s voice as a request to configure THIS agent/group (e.g. "Add a reviewer member to this group"). 1-200 chars.',
              maxLength: 200,
              minLength: 1,
              type: 'string',
            },
            title: {
              description:
                'A short chip label summarising the action. 1-40 chars, no trailing punctuation.',
              maxLength: 40,
              minLength: 1,
              type: 'string',
            },
          },
          required: ['title', 'prompt'],
          type: 'object',
        },
        maxItems: 3,
        type: 'array',
      },
    },
    required: ['suggestions'],
    type: 'object',
  },
  strict: true,
};

const AGENT_SYSTEM_PROMPT = `You generate the opening suggestion chips for an "Agent Builder" assistant. The user is configuring/building ONE AI agent through conversation. Your chips are the starting points the user can click to ask the builder to improve that agent.

Output a JSON object conforming to the supplied schema.

Guidelines:
- Return exactly 3 suggestions. Every one must be a concrete configuration action for THIS specific agent — never generic small-talk, end-user chat topics, or "ask the agent to do X" tasks.
- Prioritise GAPS in the current configuration described below: e.g. no system role -> suggest defining its role; no tools/plugins -> suggest enabling relevant ones; no opening message/questions -> suggest writing them; too generic -> suggest narrowing its specialty.
- "title" is the short chip label (1-40 chars, no trailing punctuation).
- "prompt" is the full message sent to the builder on click (1-200 chars), phrased in the user's voice as a request, e.g. "Help me refine this agent's role so it's more specific".
- Tailor the wording to the agent's name/description when given; stay specific, not boilerplate.
- Match the user's language given by the locale. Never translate proper nouns.`;

const GROUP_SYSTEM_PROMPT = `You generate the opening suggestion chips for a "Group Agent Builder" assistant. The user is configuring/building a GROUP of AI agents (members with roles, optionally a supervisor) through conversation. Your chips are the starting points the user can click to ask the builder to improve that group.

Output a JSON object conforming to the supplied schema.

Guidelines:
- Return exactly 3 suggestions. Every one must be a concrete configuration action for THIS specific group — never generic small-talk or end-user chat topics.
- Prioritise GAPS in the current setup described below: e.g. missing a needed role -> suggest adding that member; overlapping members -> suggest consolidating; unclear workflow -> suggest optimising collaboration; no group goal/prompt -> suggest defining it; no reviewer -> suggest adding one.
- "title" is the short chip label (1-40 chars, no trailing punctuation).
- "prompt" is the full message sent to the builder on click (1-200 chars), phrased in the user's voice as a request, e.g. "Add a member responsible for reviewing the group's output".
- Tailor the wording to the group's name/description and existing members when given; stay specific, not boilerplate.
- Match the user's language given by the locale. Never translate proper nouns.`;

export interface BuilderSuggestionChainParams {
  /** Pre-serialised, human-readable summary of the current agent/group config. */
  contextSummary: string;
  /** BCP-47 locale of the user, so chips match their language (e.g. `zh-CN`). */
  locale?: string;
  mode: BuilderSuggestionMode;
}

export interface BuilderSuggestionChainResult {
  messages: OpenAIChatMessage[];
  schema: BuilderSuggestionSchema;
}

/**
 * Build the messages + schema for a context-aware builder-suggestion
 * generation. The system prompt stays constant per mode so the tracing
 * `promptHash` groups runs by prompt version; everything dynamic (the current
 * config summary + locale) lives in the user message.
 */
export const chainBuilderSuggestion = ({
  mode,
  contextSummary,
  locale,
}: BuilderSuggestionChainParams): BuilderSuggestionChainResult => {
  const system = mode === 'group' ? GROUP_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  const target = mode === 'group' ? 'group' : 'agent';

  const localeLine = locale
    ? `\nThe user's language is "${locale}" — write the chips in that language.`
    : '';
  const userContent = `Here is the current configuration of the ${target} being built:\n<config>\n${contextSummary}\n</config>${localeLine}\n\nPropose exactly 3 build/configure suggestion chips that best help the user improve this ${target} from here.`;

  return {
    messages: [
      { content: system, role: 'system' },
      { content: userContent, role: 'user' },
    ],
    schema: BUILDER_SUGGESTION_SCHEMA,
  };
};
