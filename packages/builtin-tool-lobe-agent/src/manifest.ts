import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { LobeAgentApiName, LobeAgentIdentifier } from './types';

export const LobeAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Analyze images or videos selected by visual file refs or direct media URLs and answer a visual question. Use this only when the current model cannot inspect the visual media directly.',
      name: LobeAgentApiName.analyzeVisualMedia,
      parameters: {
        additionalProperties: false,
        anyOf: [{ required: ['refs'] }, { required: ['urls'] }],
        properties: {
          question: {
            description: 'The visual question or task to answer.',
            type: 'string',
          },
          refs: {
            description:
              'Visual file ref strings to analyze, such as ["image_1"] for the current user message or ["msg_xxx.image_1"] for earlier messages.',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
          urls: {
            description: 'Direct image or video URLs to analyze when no message file ref exists.',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
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
