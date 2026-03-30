import { toolSystemPrompt } from '@lobechat/builtin-agent-onboarding';
import type { BuiltinToolManifest } from '@lobechat/types';

import { WebOnboardingApiName, WebOnboardingIdentifier } from './types';

export const WebOnboardingManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Read a lightweight onboarding summary. This is advisory context for what is still useful to ask, not a strict step-machine payload.',
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
        'Read a document by type. Use "soul" to read SOUL.md (agent identity + base template), or "persona" to read the user persona document (user identity, work style, context, pain points).',
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
