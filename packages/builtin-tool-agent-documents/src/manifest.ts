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
        'Edit an existing agent document content by ID. Use this for content changes, not title rename. Prefer patchDocument for small edits.',
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
        "Apply byte-exact SEARCH/REPLACE hunks to an existing agent document by ID. Preferred over editDocument for small edits because it avoids resending the full document. Each hunk's search must match the current document exactly (whitespace, punctuation, casing). If the search appears multiple times, add surrounding context to make it unique or set replaceAll=true. On failure (HUNK_NOT_FOUND / HUNK_AMBIGUOUS), adjust and retry; fall back to editDocument only for structural rewrites that touch most of the file.",
      name: AgentDocumentsApiName.patchDocument,
      parameters: {
        properties: {
          hunks: {
            description: 'Ordered list of SEARCH/REPLACE hunks applied sequentially.',
            items: {
              additionalProperties: false,
              properties: {
                replace: {
                  description: 'Replacement text; may be empty to delete the matched region.',
                  type: 'string',
                },
                replaceAll: {
                  description:
                    'Replace every occurrence of search. Defaults to false; leave unset unless you explicitly want a global replace.',
                  type: 'boolean',
                },
                search: {
                  description: 'Byte-exact substring to locate in the current document.',
                  type: 'string',
                },
              },
              required: ['search', 'replace'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
          id: {
            description: 'Target document ID.',
            type: 'string',
          },
        },
        required: ['id', 'hunks'],
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
        'List all agent documents. Returns document id, filename, and title for each document.',
      name: AgentDocumentsApiName.listDocuments,
      parameters: {
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Read an existing agent document by its filename (similar intent to cat by filename). Use when you know the filename but not the id.',
      name: AgentDocumentsApiName.readDocumentByFilename,
      parameters: {
        properties: {
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
