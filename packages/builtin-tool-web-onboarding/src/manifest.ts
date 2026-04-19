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
        "Update an existing document by applying byte-exact SEARCH/REPLACE hunks. This is the preferred way to persist new information incrementally — it is cheaper, safer, and less error-prone than rewriting the full document with writeDocument. Each hunk's search must match the current document exactly (whitespace, punctuation, casing). If the search appears multiple times, add surrounding context to make it unique or set replaceAll=true. On failure (HUNK_NOT_FOUND / HUNK_AMBIGUOUS), adjust the search string and retry; do not fall back to writeDocument unless most of the document must change.",
      name: WebOnboardingApiName.updateDocument,
      parameters: {
        properties: {
          hunks: {
            description: 'Ordered list of SEARCH/REPLACE hunks applied sequentially.',
            items: {
              additionalProperties: false,
              properties: {
                replace: {
                  description: 'Replacement text; may be empty to delete the matched region.',
                  type: 'string',
                },
                replaceAll: {
                  description:
                    'Replace every occurrence of search. Defaults to false; leave unset unless you explicitly want a global replace.',
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
