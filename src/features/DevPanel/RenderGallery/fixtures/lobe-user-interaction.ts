'use client';

import { defineFixtures, variants } from './_helpers';

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
    askUserQuestion: variants([
      {
        args: {
          questions: [
            {
              header: 'Direction',
              multiSelect: true,
              options: [
                { description: 'Focus on the core story', label: 'Evidence pages' },
                { description: 'Polish the visual system', label: 'Visual direction' },
              ],
              question: 'Which area should we explore first?',
            },
          ],
        },
        label: 'Single question',
      },
      {
        args: {
          questions: [
            {
              header: 'Scope',
              options: [{ description: 'Start with the smallest useful slice', label: 'Focused' }],
              question: 'How broad should this pass be?',
            },
            {
              header: 'Tone',
              options: [{ description: 'Keep the interface calm', label: 'Neutral' }],
              question: 'Which visual tone should we use?',
            },
          ],
        },
        label: 'Multiple questions',
      },
    ]),
  },
});
