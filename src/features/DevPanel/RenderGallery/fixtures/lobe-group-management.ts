'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-group-management',
  fixtures: {
    broadcast: single({
      args: {
        instruction:
          'Everyone review one tool render section and flag any empty states that look broken.',
      },
    }),
    executeAgentTask: single({
      args: {
        instruction: 'Verify the `/devtools` route works in desktop development mode.',
        timeout: 1_800_000,
        title: 'Desktop smoke check',
      },
    }),
    executeAgentTasks: single({
      args: {
        tasks: [
          {
            agentId: 'researcher-agent',
            instruction: 'Check which render entries still fall back to empty-state samples.',
            title: 'Fixture audit',
          },
          {
            agentId: 'builder-agent',
            instruction:
              'Verify router gating and ensure production builds cannot navigate to /devtools.',
            title: 'Route audit',
          },
        ],
      },
    }),
    speak: single({
      args: {
        instruction:
          'Summarize the preview harness approach in two short sentences for the issue update.',
      },
    }),
  },
});
