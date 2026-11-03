import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { DocumentApiName, PageAgentIdentifier } from './types';

export const PageAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Replace the whole page with Markdown content. Use it for a new page or a full rewrite, not for targeted edits. A leading "# Heading" line becomes the page title.',
      name: DocumentApiName.initPage,
      parameters: {
        properties: {
          markdown: {
            description:
              'The complete page as Markdown: headings, paragraphs, lists, tables, images, links, code blocks.',
            type: 'string',
          },
        },
        required: ['markdown'],
        type: 'object',
      },
    },
  ],
  identifier: PageAgentIdentifier,
  meta: {
    avatar: '📄',
    description: 'Read and edit the current page',
    readme:
      'The current page is a file in the conversation sandbox: read and edit it with shell commands there, or rewrite it from Markdown.',
    title: 'Document',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
