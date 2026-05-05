'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-agent-documents',
  fixtures: {
    createDocument: single({
      args: {
        content:
          '# Devtools Preview Plan\n\n- Enumerate every render.\n- Provide a stable sample fixture.\n- Keep the page development-only.',
        title: 'Devtools Preview Plan',
      },
      pluginState: {
        documentId: 'doc_devtools_preview_plan',
      },
    }),
  },
});
