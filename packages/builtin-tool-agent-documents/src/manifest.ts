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
          target: {
            default: 'agent',
            description:
              'Where to create the document. Use currentTopic to associate it with the current topic; defaults to agent-scoped documents.',
            enum: ['agent', 'currentTopic'],
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
        'Read an existing agent document by ID. Prefer XML format before node-level edits because XML includes stable node IDs.',
      name: AgentDocumentsApiName.readDocument,
      parameters: {
        properties: {
          format: {
            default: 'xml',
            description:
              'The format to return. Use "xml" for node-level edits, "markdown" for plain text, or "both". Defaults to "xml".',
            enum: ['xml', 'markdown', 'both'],
            type: 'string',
          },
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
        'Edit an existing agent document content by ID. Use this for full-content replacement, not title rename. Prefer modifyNodes for targeted content edits.',
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
      description:
        'Perform LiteXML node operations (insert, modify, remove) on an agent document by ID. Use this for content edits after reading the document in XML format.',
      name: AgentDocumentsApiName.modifyNodes,
      parameters: {
        properties: {
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
          operations: {
            description:
              'Array of node operations. For insert, provide beforeId or afterId plus LiteXML without an id. For modify, provide LiteXML with existing node IDs. For remove, provide the node id.',
            items: {
              oneOf: [
                {
                  properties: {
                    action: { const: 'insert', type: 'string' },
                    beforeId: { description: 'ID of the node to insert before.', type: 'string' },
                    litexml: { description: 'LiteXML node to insert.', type: 'string' },
                  },
                  required: ['action', 'beforeId', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'insert', type: 'string' },
                    afterId: { description: 'ID of the node to insert after.', type: 'string' },
                    litexml: { description: 'LiteXML node to insert.', type: 'string' },
                  },
                  required: ['action', 'afterId', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'modify', type: 'string' },
                    litexml: {
                      description:
                        'LiteXML string or array of strings with existing node IDs to update.',
                      oneOf: [{ type: 'string' }, { items: { type: 'string' }, type: 'array' }],
                    },
                  },
                  required: ['action', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'remove', type: 'string' },
                    id: { description: 'ID of the node to remove.', type: 'string' },
                  },
                  required: ['action', 'id'],
                  type: 'object',
                },
              ],
            },
            minItems: 1,
            type: 'array',
          },
        },
        required: ['id', 'operations'],
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
        'List agent documents. Defaults to all agent documents; use target=currentTopic to list documents associated with the current topic.',
      name: AgentDocumentsApiName.listDocuments,
      parameters: {
        properties: {
          target: {
            default: 'agent',
            description:
              'Which document set to list. currentTopic filters to documents associated with the current topic.',
            enum: ['agent', 'currentTopic'],
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Read an existing agent document by its filename. Prefer XML format before node-level edits because XML includes stable node IDs.',
      name: AgentDocumentsApiName.readDocumentByFilename,
      parameters: {
        properties: {
          format: {
            default: 'xml',
            description:
              'The format to return. Use "xml" for node-level edits, "markdown" for plain text, or "both". Defaults to "xml".',
            enum: ['xml', 'markdown', 'both'],
            type: 'string',
          },
          filename: {
            description: 'Target document filename.',
            type: 'string',
          },
        },
        required: ['filename'],
        type: 'object',
      },
    },
    {
      description:
        'Create or update an agent document by filename. If a document with the given filename exists, its content is updated; otherwise a new document is created.',
      name: AgentDocumentsApiName.upsertDocumentByFilename,
      parameters: {
        properties: {
          content: {
            description: 'Document content in markdown or plain text.',
            type: 'string',
          },
          filename: {
            description: 'Target document filename.',
            type: 'string',
          },
        },
        required: ['filename', 'content'],
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
      'Manage agent-scoped documents (list/create/read/edit/remove/rename/copy/upsert) and load rules',
    title: 'Documents',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
