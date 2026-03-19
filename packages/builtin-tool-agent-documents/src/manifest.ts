import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AgentDocumentsApiName, AgentDocumentsIdentifier } from './types';

export const AgentDocumentsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a new agent document. This is the document-create operation (similar intent to touch/create with initial content).',
      name: AgentDocumentsApiName.createDocument,
      parameters: {
        properties: {
          content: {
            description: 'Document content in markdown or plain text.',
            type: 'string',
          },
          title: {
            description: 'Document title.',
            type: 'string',
          },
        },
        required: ['title', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Read an existing agent document by ID (similar intent to cat/read operation). Use this before edits or deletes when needed.',
      name: AgentDocumentsApiName.readDocument,
      parameters: {
        properties: {
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Edit an existing agent document content by ID. Use this for content changes, not title rename.',
      name: AgentDocumentsApiName.editDocument,
      parameters: {
        properties: {
          content: {
            description: 'Updated full document content.',
            type: 'string',
          },
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
        },
        required: ['id', 'content'],
        type: 'object',
      },
    },
    {
      description: 'Remove an existing agent document by ID (similar intent to rm/delete).',
      name: AgentDocumentsApiName.removeDocument,
      parameters: {
        properties: {
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Rename an existing document title by ID (similar intent to mv/rename title-level operation).',
      name: AgentDocumentsApiName.renameDocument,
      parameters: {
        properties: {
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
          newTitle: {
            description: 'New title after rename.',
            type: 'string',
          },
        },
        required: ['id', 'newTitle'],
        type: 'object',
      },
    },
    {
      description: 'Copy an existing document to a new document (similar intent to cp/copy).',
      name: AgentDocumentsApiName.copyDocument,
      parameters: {
        properties: {
          id: {
            description: 'Source document ID.',
            type: 'string',
          },
          newTitle: {
            description: 'Optional title for the copied document.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Update agent-document load rules. Use this to control how documents are loaded into runtime context.',
      name: AgentDocumentsApiName.updateLoadRule,
      parameters: {
        properties: {
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
          rule: {
            description: 'New load rule settings.',
            properties: {
              maxTokens: {
                description: 'Maximum token budget for this document when injected.',
                minimum: 0,
                type: 'number',
              },
              priority: {
                description: 'Lower value means higher load priority.',
                minimum: 0,
                type: 'number',
              },
            },
            type: 'object',
          },
        },
        required: ['id', 'rule'],
        type: 'object',
      },
    },
  ],
  identifier: AgentDocumentsIdentifier,
  meta: {
    avatar: '🗂️',
    description:
      'Manage agent-scoped documents (create/read/edit/remove/rename/copy) and load rules',
    title: 'Documents',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
