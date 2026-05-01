import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { LobeAgentApiName, LobeAgentIdentifier } from './types';

export const LobeAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Analyze the images or videos attached to the current user message and answer a visual question. Use this only when the current model cannot inspect the visual media directly.',
      name: LobeAgentApiName.analyzeVisualMedia,
      parameters: {
        additionalProperties: false,
        properties: {
          files: {
            description:
              'Optional visual file refs, such as image_1 for the current message or msg_xxx.image_1 for earlier messages. Omit this field to analyze all current visual files.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          question: {
            description: 'The visual question or task to answer.',
            type: 'string',
          },
        },
        required: ['question'],
        type: 'object',
      },
    },
  ],
  identifier: LobeAgentIdentifier,
  meta: {
    avatar: '👁️',
    description: 'Run built-in agent capabilities, including visual media analysis.',
    readme:
      'Analyze visual media from the current user message when the active chat model cannot directly inspect images or videos.',
    title: 'Lobe Agent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
