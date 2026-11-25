import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { A2uiApiName, A2uiIdentifier } from './types';

export const A2uiManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Draw a card in the conversation from A2UI 1.0 messages for one surface: createSurface, updateComponents (flat components with ids, one with id "root") and optionally updateDataModel. Mostly for showing information visually (reports, comparisons, schedules, profiles, metrics, charts, tables); also for multi-field input. Design the layout for the content. Not for prose. Invalid cards come back with errors to fix.',
      name: A2uiApiName.renderUI,
      parameters: {
        properties: {
          operations: {
            description:
              'The A2UI messages, in order. Each is an object with "version": "1.0" and one of createSurface, updateComponents, updateDataModel, all naming the same surfaceId.',
            items: { type: 'object' },
            type: 'array',
          },
        },
        required: ['operations'],
        type: 'object',
      },
    },
  ],
  identifier: A2uiIdentifier,
  meta: {
    avatar: '🧩',
    description: 'Answer with visual cards: reports, comparisons, schedules, charts, tables and forms',
    title: 'Cards',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
