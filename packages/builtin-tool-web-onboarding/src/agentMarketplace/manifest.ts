import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  AgentMarketplaceApiName,
  AgentMarketplaceIdentifier,
  MARKETPLACE_CATEGORY_VALUES,
} from './types';

export const AgentMarketplaceManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Open an Agent Marketplace picker card in the UI, prioritizing tabs by the provided category hints. Returns the request in pending state.',
      humanIntervention: 'always',
      name: AgentMarketplaceApiName.showAgentMarketplace,
      renderDisplayControl: 'collapsed',
      parameters: {
        properties: {
          categoryHints: {
            description:
              'One or more fixed MarketplaceCategory slugs used to move matching picker tabs to the front.',
            items: {
              enum: [...MARKETPLACE_CATEGORY_VALUES],
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
          description: {
            description: 'Optional secondary line shown below the prompt.',
            type: 'string',
          },
          prompt: {
            description:
              'Short, natural sentence shown to the user explaining what the marketplace is for.',
            type: 'string',
          },
          requestId: {
            description: 'Unique identifier for this pick request.',
            type: 'string',
          },
        },
        required: ['categoryHints', 'prompt', 'requestId'],
        type: 'object',
      },
    },
    {
      description:
        "Record the user's template selection for a pending pick request. Normally client-handled after the user submits in the UI.",
      name: AgentMarketplaceApiName.submitAgentPick,
      parameters: {
        properties: {
          requestId: { description: 'The pick request ID to submit.', type: 'string' },
          selectedTemplateIds: {
            description: 'Template IDs the user selected from the marketplace.',
            items: { type: 'string' },
            minItems: 1,
            type: 'array',
          },
        },
        required: ['requestId', 'selectedTemplateIds'],
        type: 'object',
      },
    },
  ],
  identifier: AgentMarketplaceIdentifier,
  meta: {
    avatar: '🛍️',
    description:
      'Show users a curated Agent Marketplace card and record which templates they pick.',
    title: 'Agent Marketplace',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
