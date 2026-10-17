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
    createFolder: single({
      args: { title: 'Patrol reports' },
      pluginState: {
        agentDocumentId: 'agent_doc_folder_patrol',
        created: true,
        documentId: 'doc_folder_patrol',
        title: 'Patrol reports',
      },
    }),
    moveDocuments: single({
      args: { ids: ['agent_doc_run_1', 'agent_doc_run_2'], parentId: 'doc_folder_patrol' },
      pluginState: {
        failedCount: 1,
        movedCount: 1,
        parentId: 'doc_folder_patrol',
        results: [
          { id: 'agent_doc_run_1', status: 'moved', title: 'Run record 2026-10-10' },
          {
            error: '"Run record 2026-10-11" already exists in the destination folder.',
            id: 'agent_doc_run_2',
            status: 'failed',
            title: 'Run record 2026-10-11',
          },
        ],
      },
    }),
  },
});
