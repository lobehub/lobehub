import { type BuiltinToolManifest, QUICK_NOTE_RESOURCE_TYPES } from '@lobechat/types';

import { QuickNoteApiName } from './types';

export const QuickNoteIdentifier = 'lobe-quick-note';

const stringList = { items: { type: 'string' }, type: 'array' };

export const QuickNoteManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Submit the output of this Quick Note run. Call it exactly once, on its own, as your final action: it records the result and ends the run. A text answer is not recorded. A rejected call explains what to fix; call again with corrected arguments.',
      name: QuickNoteApiName.submitResult,
      parameters: {
        properties: {
          contextQueries: {
            ...stringList,
            description:
              'Short literal terms for looking up related Topics and Documents. Empty when linking was not requested.',
          },
          delegate: {
            additionalProperties: true,
            description:
              'The delegate draft, in exactly the shape the instructions give. Omit it when no delegate was requested.',
            type: 'object',
          },
          relatedResources: {
            description:
              'Supplied context candidates that are clearly related, with their exact type and id. Empty when linking was not requested.',
            items: {
              properties: {
                id: { type: 'string' },
                selector: { type: 'object' },
                type: { enum: [...QUICK_NOTE_RESOURCE_TYPES], type: 'string' },
              },
              required: ['type', 'id'],
              type: 'object',
            },
            type: 'array',
          },
          summary: { description: 'Markdown overview of the note.', type: 'string' },
          tags: { ...stringList, description: 'At most five short tags.' },
        },
        required: ['summary', 'tags', 'contextQueries', 'relatedResources'],
        type: 'object',
      },
    },
  ],
  identifier: QuickNoteIdentifier,
  meta: {
    avatar: '📝',
    description: 'Submit the result of a Quick Note run',
    title: 'Quick Note',
  },
  systemRole:
    'You are working on one Quick Note. When your work is done, call submitResult exactly once with the complete output. Only submitResult records the output; a text answer does not.',
  type: 'builtin',
};
