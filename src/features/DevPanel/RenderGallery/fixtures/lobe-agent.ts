'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-agent',
  fixtures: {
    callSubAgent: single({
      pluginState: {
        task: {
          description: 'Smoke test the desktop router config',
          instruction:
            'Run the desktop router sync test and confirm /devtools only appears in development.',
        },
      },
    }),
    callSubAgents: single({
      pluginState: {
        tasks: [
          {
            description: 'Audit builtin render coverage',
            instruction: 'Find any registered render without a usable sample fixture.',
          },
          {
            description: 'Check route gating',
            instruction: 'Make sure production builds do not expose /devtools.',
          },
        ],
      },
    }),
  },
});
