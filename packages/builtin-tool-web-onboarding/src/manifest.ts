import type { BuiltinToolManifest } from '@lobechat/types';

import { toolSystemPrompt } from './toolSystemRole';
import { WebOnboardingApiName, WebOnboardingIdentifier } from './types';

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
        'Persist structured onboarding fields. Use for agentName and agentEmoji (updates inbox agent title/avatar), fullName, interests, and responseLanguage.',
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
        'Update a document by type with full content. Use "soul" for SOUL.md (agent identity + base template only, no user info), or "persona" for user persona (user identity, work style, context, pain points only, no agent info).',
      name: WebOnboardingApiName.updateDocument,
      parameters: {
        properties: {
          content: {
            description: 'The full updated document content in markdown format.',
            type: 'string',
          },
          type: {
            description: 'Document type to update.',
            enum: ['soul', 'persona'],
            type: 'string',
          },
        },
        required: ['type', 'content'],
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
