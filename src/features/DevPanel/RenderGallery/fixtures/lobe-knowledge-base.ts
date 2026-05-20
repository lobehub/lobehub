'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-knowledge-base',
  fixtures: {
    readKnowledge: single({
      pluginState: {
        files: [
          {
            fileId: 'kb_devtools_guide',
            filename: 'devtools-preview-guide.md',
            preview:
              'Use the /devtools route to visually verify builtin tool renders during development.',
            totalCharCount: 1420,
            totalLineCount: 42,
          },
        ],
      },
    }),
    searchKnowledgeBase: single({
      pluginState: {
        fileResults: [
          {
            fileId: 'kb_router_preview',
            fileName: 'router-preview-checklist.md',
            relevanceScore: 0.93,
          },
          {
            fileId: 'kb_tool_fixtures',
            fileName: 'tool-render-fixtures.md',
            relevanceScore: 0.88,
          },
        ],
      },
    }),
  },
});
