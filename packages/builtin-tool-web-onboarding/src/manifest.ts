import type { BuiltinToolManifest, HumanInterventionRule } from '@lobechat/types';

import { toolSystemPrompt } from './toolSystemRole';
import { WebOnboardingApiName, WebOnboardingIdentifier } from './types';

const agentIdentityConfirmationRules: HumanInterventionRule[] = [
  {
    match: {
      agentName: { pattern: '\\S', type: 'regex' },
    },
    policy: 'always',
  },
  {
    match: {
      agentEmoji: { pattern: '\\S', type: 'regex' },
    },
    policy: 'always',
  },
  { policy: 'never' },
] satisfies HumanInterventionRule[];

export const WebOnboardingManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Read a lightweight onboarding summary. Note: phase and missing-fields are automatically injected into your system context each turn, so this tool is only needed as a fallback when you are uncertain about the current state.',
      name: WebOnboardingApiName.getOnboardingState,
      parameters: {
        properties: {},
        type: 'object',
      },
      renderDisplayControl: 'collapsed',
    },
    {
      description:
        'Persist structured onboarding fields. Use for agentName and agentEmoji (updates inbox agent title/avatar and requires user confirmation), fullName, interests, and responseLanguage.',
      humanIntervention: agentIdentityConfirmationRules,
      name: WebOnboardingApiName.saveUserQuestion,
      parameters: {
        additionalProperties: false,
        properties: {
          agentEmoji: {
            description: 'Emoji avatar for the agent (updates inbox agent avatar).',
            type: 'string',
          },
          agentName: {
            description: 'Name for the agent (updates inbox agent title).',
            type: 'string',
          },
          fullName: {
            type: 'string',
          },
          interests: {
            items: {
              type: 'string',
            },
            type: 'array',
          },
          responseLanguage: {
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      description:
        'Finish onboarding once the summary is confirmed and the user is ready to proceed.',
      name: WebOnboardingApiName.finishOnboarding,
      parameters: {
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Read a document by type. Note: document contents are automatically injected into your system context (in <current_soul_document> and <current_user_persona> tags), so this tool is only needed as a fallback. Use "soul" for SOUL.md or "persona" for the user persona document.',
      name: WebOnboardingApiName.readDocument,
      parameters: {
        properties: {
          type: {
            description: 'Document type to read.',
            enum: ['soul', 'persona'],
            type: 'string',
          },
        },
        required: ['type'],
        type: 'object',
      },
    },
    {
      description:
        'Write a document with full content, replacing anything that existed. Use "soul" for SOUL.md (agent identity + base template only, no user info), or "persona" for user persona (user identity, work style, context, pain points only, no agent info). Use writeDocument only for the very first write when the document is empty, or when the entire structure must change. For every subsequent edit, call updateDocument instead — it is cheaper and safer.',
      name: WebOnboardingApiName.writeDocument,
      parameters: {
        properties: {
          content: {
            description: 'The full document content in markdown format.',
            type: 'string',
          },
          type: {
            description: 'Document type to write.',
            enum: ['soul', 'persona'],
            type: 'string',
          },
        },
        required: ['type', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Update an existing document by applying structured hunks. Preferred over writeDocument for every incremental edit — cheaper, safer, less error-prone. Each hunk picks ONE mode:\n' +
        '- `replace` (default): byte-exact SEARCH → REPLACE. For small textual tweaks.\n' +
        '- `delete`: remove the byte-exact SEARCH region.\n' +
        '- `deleteLines`: drop lines [startLine, endLine] (1-based, inclusive). Use the line numbers shown in <current_*_document>.\n' +
        '- `insertAt`: insert `content` before `line`. Use `line = totalLines + 1` to append to the end; `line = 1` to prepend.\n' +
        '- `replaceLines`: replace lines [startLine, endLine] with `content`.\n' +
        'Line-based hunks REQUIRE the line numbers from the injected <current_soul_document> / <current_user_persona> view. On failure (HUNK_NOT_FOUND / HUNK_AMBIGUOUS / LINE_OUT_OF_RANGE / LINE_OVERLAP), re-check the injected document and retry with corrected hunks; do NOT fall back to writeDocument unless most of the document must change.',
      name: WebOnboardingApiName.updateDocument,
      parameters: {
        properties: {
          hunks: {
            description:
              'Ordered list of hunks. Content-based hunks (replace/delete) run first in order; line-based hunks (deleteLines/insertAt/replaceLines) run afterward, highest line first.',
            items: {
              oneOf: [
                {
                  additionalProperties: false,
                  properties: {
                    mode: { const: 'replace', type: 'string' },
                    replace: {
                      description: 'Replacement text; may be empty to delete the matched region.',
                      type: 'string',
                    },
                    replaceAll: {
                      description: 'Replace every occurrence of search. Defaults to false.',
                      type: 'boolean',
                    },
                    search: {
                      description: 'Byte-exact substring to locate in the current document.',
                      type: 'string',
                    },
                  },
                  required: ['search', 'replace'],
                  type: 'object',
                },
                {
                  additionalProperties: false,
                  properties: {
                    mode: { const: 'delete', type: 'string' },
                    replaceAll: { type: 'boolean' },
                    search: {
                      description: 'Byte-exact substring to remove.',
                      type: 'string',
                    },
                  },
                  required: ['mode', 'search'],
                  type: 'object',
                },
                {
                  additionalProperties: false,
                  properties: {
                    endLine: {
                      description: 'Inclusive 1-based end line.',
                      type: 'integer',
                    },
                    mode: { const: 'deleteLines', type: 'string' },
                    startLine: {
                      description: 'Inclusive 1-based start line.',
                      type: 'integer',
                    },
                  },
                  required: ['mode', 'startLine', 'endLine'],
                  type: 'object',
                },
                {
                  additionalProperties: false,
                  properties: {
                    content: {
                      description: 'Text to insert; may span multiple lines (use \\n).',
                      type: 'string',
                    },
                    line: {
                      description:
                        '1-based line to insert before. Use `totalLines + 1` to append to the end.',
                      type: 'integer',
                    },
                    mode: { const: 'insertAt', type: 'string' },
                  },
                  required: ['mode', 'line', 'content'],
                  type: 'object',
                },
                {
                  additionalProperties: false,
                  properties: {
                    content: {
                      description: 'Replacement text; may be empty to delete the range.',
                      type: 'string',
                    },
                    endLine: { type: 'integer' },
                    mode: { const: 'replaceLines', type: 'string' },
                    startLine: { type: 'integer' },
                  },
                  required: ['mode', 'startLine', 'endLine', 'content'],
                  type: 'object',
                },
              ],
            },
            minItems: 1,
            type: 'array',
          },
          type: {
            description: 'Document type to patch.',
            enum: ['soul', 'persona'],
            type: 'string',
          },
        },
        required: ['type', 'hunks'],
        type: 'object',
      },
    },
  ],
  identifier: WebOnboardingIdentifier,
  meta: {
    avatar: '🧭',
    description: 'Drive the web onboarding flow with a controlled agent runtime',
    title: 'Web Onboarding',
  },
  systemRole: toolSystemPrompt,
  type: 'builtin',
};
