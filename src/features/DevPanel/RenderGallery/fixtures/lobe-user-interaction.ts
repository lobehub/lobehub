'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-user-interaction',
  meta: {
    description: 'User Interaction intervention previews.',
    title: 'User Interaction',
  },
  apiList: [
    {
      description: 'Render an inline question card with form fields.',
      name: 'askUserQuestion',
    },
  ],
  fixtures: {
    askUserQuestion: single({
      args: {
        question: {
          description:
            'Help us tailor the next reply. Pick the rendering surface you want previewed.',
          fields: [
            {
              key: 'surface',
              kind: 'select',
              label: 'Preview surface',
              options: [
                { label: 'Render', value: 'render' },
                { label: 'Streaming', value: 'streaming' },
                { label: 'Placeholder', value: 'placeholder' },
                { label: 'Intervention', value: 'intervention' },
              ],
              placeholder: 'Choose one',
              required: true,
            },
            {
              key: 'note',
              kind: 'textarea',
              label: 'Optional note',
              placeholder: 'Anything to call out about the preview?',
            },
          ],
          id: 'devtools-preview-question',
          mode: 'form',
          prompt: 'Which builtin tool surface should we focus the next preview iteration on?',
        },
      },
    }),
  },
});
