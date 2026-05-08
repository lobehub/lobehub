import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ActivatorApiName, LobeActivatorIdentifier } from './types';

export const LobeActivatorManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Activate tools from the <available_tools> list so their full API schemas become available for use. Call this before using any tool that is not yet activated. You can activate multiple tools at once.',
      humanIntervention: 'required',
      name: ActivatorApiName.activateTools,
      parameters: {
        properties: {
          identifiers: {
            description:
              'Array of tool identifiers to activate. Use the identifiers from the <available_tools> list.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['identifiers'],
        type: 'object',
      },
    },
  ],
  identifier: LobeActivatorIdentifier,
  meta: {
    avatar: '🔧',
    description: 'Discover and activate tools',
    title: 'Tools Activator',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
