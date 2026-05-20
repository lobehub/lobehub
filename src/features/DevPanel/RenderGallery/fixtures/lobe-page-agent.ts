'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-page-agent',
  meta: {
    description: 'Page Agent inspector previews for document operations.',
    title: 'Page Agent',
  },
  apiList: [
    {
      description: 'Initialize a new document with markdown content.',
      name: 'initPage',
    },
    {
      description: 'Edit the title of the current document.',
      name: 'editTitle',
    },
    {
      description: 'Read the structured XML content of the page.',
      name: 'getPageContent',
    },
    {
      description: 'Insert, modify, or remove document nodes.',
      name: 'modifyNodes',
    },
    {
      description: 'Find-and-replace text across the document.',
      name: 'replaceText',
    },
  ],
  fixtures: {
    initPage: single({
      args: {
        markdown:
          '# Devtools Render Gallery\n\nA development-only preview surface for every builtin tool render.\n\n- Inspector previews mirror the chat title bar.\n- Body segments switch between Render, Streaming, Placeholder, and Intervention.\n',
      },
      pluginState: { nodeCount: 6 },
    }),
    editTitle: single({
      args: { title: 'Devtools Render Gallery — Builtin Tool Previews' },
      pluginState: { previousTitle: 'Devtools Render Gallery' },
    }),
    getPageContent: single({
      args: {},
      pluginState: { nodeCount: 12 },
      content:
        '<doc><heading id="h-1">Devtools Render Gallery</heading><para id="p-1">Preview every registered builtin tool component.</para></doc>',
    }),
    modifyNodes: single({
      args: {
        operations: [
          { afterId: 'h-1', kind: 'insertAfter', xml: '<para>Updated description.</para>' },
          {
            id: 'p-2',
            kind: 'modify',
            xml: '<para id="p-2">Now mentions Segmented body tabs.</para>',
          },
          { id: 'p-3', kind: 'remove' },
        ],
      },
      pluginState: { applied: 3 },
    }),
    replaceText: single({
      args: {
        isRegex: false,
        newText: 'Body segments',
        replaceAll: true,
        searchText: 'Body section',
      },
      pluginState: { replacements: 2 },
    }),
  },
});
