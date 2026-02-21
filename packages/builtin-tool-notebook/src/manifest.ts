import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { NotebookApiName, NotebookIdentifier } from './types';

export const NotebookManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a new document in the notebook. Use this to save reports, notes, articles, or any content that should persist in the topic.',
      name: NotebookApiName.createDocument,
      parameters: {
        properties: {
          content: {
            description: 'The document content in Markdown format',
            type: 'string',
          },
          description: {
            description: 'A brief summary of the document (1-2 sentences)',
            type: 'string',
          },
          title: {
            description: 'A descriptive title for the document',
            type: 'string',
          },
          type: {
            default: 'markdown',
            description: 'The type of document',
            enum: ['markdown', 'note', 'report', 'article'],
            type: 'string',
          },
        },
        required: ['title', 'description', 'content'],
        type: 'object',
      },
      renderDisplayControl: 'alwaysExpand',
    },
    {
      description:
        'Update an existing document. Can modify title, content, or append new content to existing document.',
      name: NotebookApiName.updateDocument,
      parameters: {
        properties: {
          append: {
            default: false,
            description: 'If true, append content to existing document instead of replacing',
            type: 'boolean',
          },
          content: {
            description: 'New content for the document',
            type: 'string',
          },
          id: {
            description: 'The document ID to update',
            type: 'string',
          },
          title: {
            description: 'New title for the document',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'Retrieve the full content of a specific document from the notebook.',
      name: NotebookApiName.getDocument,
      parameters: {
        properties: {
          id: {
            description: 'The document ID to retrieve',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'Delete a document from the notebook. This action cannot be undone.',
      name: NotebookApiName.deleteDocument,
      parameters: {
        properties: {
          id: {
            description: 'The document ID to delete',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
  ],
  identifier: NotebookIdentifier,
  meta: {
    avatar: '📓',
    description: 'Create and manage documents in the topic notebook',
    readme:
      'Create and manage persistent documents within conversation topics. Save notes, reports, articles, and markdown content that stays accessible across sessions.',
    title: 'Notebook',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
