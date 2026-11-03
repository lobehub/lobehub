'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-notebook',
  fixtures: {
    createDocument: single({
      pluginState: {
        document: {
          content:
            '# Devtools route\n\nThis page renders every registered builtin tool card with sample fixtures so local QA stays fast.',
          id: 'notebook_devtools_route',
          title: 'Devtools Route Notes',
        },
      },
    }),
  },
});
