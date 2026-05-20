'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'github',
  fixtures: {
    run_command: single({
      args: {
        command: 'gh api /repos/lobehub/lobe-chat/issues?state=open',
      },
      pluginState: {
        command: 'gh api /repos/lobehub/lobe-chat/issues?state=open',
        exitCode: 0,
        success: true,
      },
    }),
  },
});
