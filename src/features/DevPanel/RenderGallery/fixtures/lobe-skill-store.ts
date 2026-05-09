'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-skill-store',
  fixtures: {
    importFromMarket: single({
      content: 'preview-builder',
      pluginState: {
        name: 'preview-builder',
        status: 'created',
        success: true,
      },
    }),
    importSkill: single({
      content: 'preview-builder',
      pluginState: {
        name: 'preview-builder',
        status: 'updated',
        success: true,
      },
    }),
    searchSkill: single({
      pluginState: {
        items: [
          {
            category: 'Engineering',
            description: 'Scaffold and maintain internal preview routes for UI checks.',
            identifier: 'preview-builder',
            installCount: 128,
            name: 'Preview Builder',
            repository: 'https://github.com/lobehub/preview-builder',
            summary: 'Reusable preview harness workflows.',
            version: '0.3.1',
          },
        ],
      },
    }),
  },
});
