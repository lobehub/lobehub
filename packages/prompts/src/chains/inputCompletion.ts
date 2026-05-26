import type { OpenAIChatMessage } from '@lobechat/types';

/**
 * Bump when editing the autocomplete system prompt or schema below. Plumbed
 * through `metadata.promptVersion` at the call site so per-call tracing
 * groups runs by prompt iteration. The 6-char prompt hash on the row catches
 * forgotten bumps.
 */
export const INPUT_COMPLETION_PROMPT_VERSION = 'v1.1';

/**
 * Symbolic schema name — also recorded on the tracing row's `schemaName`
 * column so prompt iterations and schema renames can be reasoned about
 * together.
 */
export const INPUT_COMPLETION_SCHEMA_NAME = 'InputCompletion';

/**
 * Minimal `generateObject` schema: a single `completion` string. The JSON
 * wrapping overhead is ~15-30 tokens, which is negligible against the model's
 * ~100-token completion budget but unlocks per-call tracing via the existing
 * `ModelRuntime.generateObject` hook.
 */
export interface InputCompletionSchema {
  name: typeof INPUT_COMPLETION_SCHEMA_NAME;
  schema: {
    additionalProperties: false;
    properties: {
      completion: { description: string; type: 'string' };
    };
    required: ['completion'];
    type: 'object';
  };
  strict: true;
}

const INPUT_COMPLETION_SCHEMA: InputCompletionSchema = {
  name: INPUT_COMPLETION_SCHEMA_NAME,
  schema: {
    additionalProperties: false,
    properties: {
      completion: {
        description: 'The missing text to insert at the cursor. Empty string for no suggestion.',
        type: 'string',
      },
    },
    required: ['completion'],
    type: 'object',
  },
  strict: true,
};

const SYSTEM_PROMPT = `You are an autocomplete engine for a chat input box. The user is composing a message to send to an AI assistant. Predict and complete what the USER is typing. Return only the missing text to insert at the cursor in the JSON object's \`completion\` field.

CRITICAL RULES:
- You are completing the USER's message, NOT the AI assistant's response
- The completed text should read as something a human would type to ask, request, or tell an AI
- NEVER generate text that sounds like an AI assistant responding (e.g., "help you", "assist you", "I can help")
- Keep it short and natural, under 15 words
- Match the user's language
- If no completion would be useful, return an empty string

GOOD examples (user perspective):
"How can I " → "optimize my React component's performance?"
"Hi" → ", I need help with a TypeScript issue"
"Can you " → "explain how useEffect cleanup works?"
"帮我" → "写一个数据库查询的优化方案"
"Let me " → "describe the bug I'm seeing"
"我想" → "了解一下如何部署到 Kubernetes"

BAD examples (assistant perspective — NEVER do this):
"How can I " → "help you today?" ← WRONG: this is what an AI assistant says
"Hi" → ", how can I help you?" ← WRONG: assistant greeting
"Let me " → "explain that for you" ← WRONG: assistant offering to explain`;

export interface InputCompletionChainResult {
  messages: OpenAIChatMessage[];
  schema: InputCompletionSchema;
}

export const chainInputCompletion = (
  beforeCursor: string,
  afterCursor: string,
  context?: OpenAIChatMessage[],
): InputCompletionChainResult => {
  // Context is dynamic per conversation — keep it OUT of the system message so
  // the system prompt (and thus the tracing `promptHash`) stays stable across
  // invocations. Otherwise every keystroke in a longer conversation produces a
  // distinct hash, defeating the per-prompt grouping.
  const contextMessage: OpenAIChatMessage | null = context?.length
    ? {
        content: `Current conversation context:\n${context.map((m) => `${m.role}: ${m.content}`).join('\n')}`,
        role: 'user',
      }
    : null;

  return {
    messages: [
      { content: SYSTEM_PROMPT, role: 'system' },
      ...(contextMessage ? [contextMessage] : []),
      {
        content: `Before cursor: "${beforeCursor}"\nAfter cursor: "${afterCursor}"`,
        role: 'user',
      },
    ],
    schema: INPUT_COMPLETION_SCHEMA,
  };
};
