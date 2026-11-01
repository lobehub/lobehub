import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  AgentDocumentsApiName,
  AgentDocumentsIdentifier,
  LIST_DOCUMENTS_DEFAULT_LIMIT,
  LIST_DOCUMENTS_MAX_LIMIT,
  MOVE_DOCUMENTS_MAX_IDS,
} from './types';

const AGENT_DOCUMENT_ID_DESCRIPTION =
  'Target agent document ID. Use the "id" field returned by listDocuments, not "documentId".';

export const AgentDocumentsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a new agent document. This is the document-create operation (similar intent to touch/create with initial content).',
      name: AgentDocumentsApiName.createDocument,
      parameters: {
        properties: {
          content: {
            description:
              'Document content in Markdown. Put JSON, code or any text that must stay byte-exact inside a fenced code block (```json … ```); outside code, Markdown syntax such as `\\`, `__` or `*` is interpreted. Do not open with an H1 (`#`) heading — the title renders as the document header and the leading H1 is removed automatically; start directly with the body and use `##` or deeper for sections.',
            type: 'string',
          },
          hintIsSkill: {
            default: false,
            description:
              'Set true only when the document captures reusable procedural knowledge or durable agent behavior.',
            type: 'boolean',
          },
          parentId: {
            description:
              'Parent to create the document under: a folder, or a document such as the workflow/SOP whose run this document records. Pass its "documentId" (or "id") from listDocuments or createFolder. Omit to create at the root. Fails if the parent does not exist.',
            type: 'string',
          },
          scope: {
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
      work: {
        action: 'create',
        resourceType: 'document',
      },
    },
    {
      description:
        'Read an existing agent document by ID. Prefer XML format before node-level edits because XML includes stable node IDs. Long documents are returned one window at a time; a partial read ends with the offset to continue from.',
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
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
            type: 'string',
          },
          limit: {
            description:
              'Maximum number of lines to return. Omit to read as much as fits in one response.',
            type: 'integer',
          },
          offset: {
            description:
              '1-based line to start reading from. Use the offset given at the end of a partial read to continue.',
            type: 'integer',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Replace the entire content of an existing agent document by ID. Use this only when overwriting most or all of the document. Prefer modifyNodes for targeted edits.',
      name: AgentDocumentsApiName.replaceDocumentContent,
      parameters: {
        properties: {
          content: {
            description:
              'New full document content in Markdown. Put JSON, code or any text that must stay byte-exact inside a fenced code block (```json … ```). Do not open with an H1 (`#`) heading — the title renders as the document header and the leading H1 is removed automatically; use `##` or deeper for sections.',
            type: 'string',
          },
          id: {
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
            type: 'string',
          },
        },
        required: ['id', 'content'],
        type: 'object',
      },
      work: {
        action: 'update',
        resourceType: 'document',
      },
    },
    {
      description:
        'Perform LiteXML node operations (insert, modify, remove) on an agent document by ID. Use this for content edits after reading the document in XML format.',
      name: AgentDocumentsApiName.modifyNodes,
      parameters: {
        properties: {
          id: {
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
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
      work: {
        action: 'update',
        resourceType: 'document',
      },
    },
    {
      description:
        'Remove an existing agent document or folder by ID (similar intent to rm). A document or folder with nested children is refused unless withChildren is true.',
      name: AgentDocumentsApiName.removeDocument,
      parameters: {
        properties: {
          id: {
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
            type: 'string',
          },
          withChildren: {
            description:
              'Also delete every document nested under it. Only set this when the user wants the children gone too; otherwise move them out first.',
            type: 'boolean',
          },
        },
        required: ['id'],
        type: 'object',
      },
      work: {
        action: 'delete',
        resourceType: 'document',
      },
    },
    {
      description:
        'Rename an existing document title by ID (similar intent to mv/rename title-level operation).',
      name: AgentDocumentsApiName.renameDocument,
      parameters: {
        properties: {
          id: {
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
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
      work: {
        action: 'update',
        resourceType: 'document',
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
      work: {
        action: 'create',
        resourceType: 'document',
      },
    },
    {
      description:
        'Create a folder for organizing agent documents (similar intent to mkdir -p). Idempotent: if a folder with the same name already exists in that location it is returned instead of creating a duplicate, so it is safe to call on every scheduled run.',
      name: AgentDocumentsApiName.createFolder,
      parameters: {
        properties: {
          parentId: {
            description:
              'Parent folder or document ("documentId" or "id" from listDocuments/createFolder). Omit to create at the root.',
            type: 'string',
          },
          title: {
            description: 'Folder name. Cannot contain "/" or "\\".',
            type: 'string',
          },
        },
        required: ['title'],
        type: 'object',
      },
    },
    {
      description: `Move documents and/or folders under a folder or a document, or back to the root (similar intent to mv). Accepts up to ${MOVE_DOCUMENTS_MAX_IDS} ids per call, so a whole set can be filed in one call. Titles, ids, content, history and load rules are kept. Each id is reported as moved, unchanged (already there) or failed with a reason; one failure does not stop the rest.`,
      name: AgentDocumentsApiName.moveDocuments,
      parameters: {
        properties: {
          ids: {
            description:
              'Documents or folders to move: the "id" (or "documentId") of each entry from listDocuments.',
            items: { type: 'string' },
            maxItems: MOVE_DOCUMENTS_MAX_IDS,
            minItems: 1,
            type: 'array',
          },
          parentId: {
            description:
              'Destination folder or document ("documentId" or "id" from listDocuments/createFolder). Pass null to move to the root.',
            type: ['string', 'null'],
          },
        },
        required: ['ids', 'parentId'],
        type: 'object',
      },
    },
    {
      description:
        "List agent documents (this agent's own notes/skills/structured docs). Use this to discover documents that are not auto-injected (e.g. web-crawled pages), to expand a folder collapsed in the agent_documents_index, or to resolve a title to a document ID. Each entry reports its type (file or folder), parentId (null at the root), childCount when something is nested under it (documents can hold children too) and updatedAt. Do NOT use this to find the user's uploaded files (PDFs, images, general uploads) — those live in the resource library and are covered by the Knowledge Base tool's listFiles, not here.",
      name: AgentDocumentsApiName.listDocuments,
      parameters: {
        properties: {
          limit: {
            description: `Maximum number of documents to return (default ${LIST_DOCUMENTS_DEFAULT_LIMIT}, max ${LIST_DOCUMENTS_MAX_LIMIT}).`,
            type: 'number',
          },
          offset: {
            description:
              'Number of documents to skip. Use the offset given at the end of a truncated listing to fetch the next page.',
            type: 'number',
          },
          parentId: {
            description:
              'Restrict the listing to the direct children of this parent — a folder or a document. Pass the id shown on a collapsed row in the agent_documents_index, or a "documentId"/"id" from a previous listing. Fails if the parent does not exist. Without parentId every document is listed, including nested ones; use each entry\'s "parentId" (null = root) to tell where it sits.',
            type: 'string',
          },
          scope: {
            default: 'agent',
            description:
              'Which document set to list. Defaults to "agent" (all agent-scoped documents). Use "currentTopic" to filter to documents associated with the current topic.',
            enum: ['agent', 'currentTopic'],
            type: 'string',
          },
          sourceType: {
            default: 'all',
            description: `Filter by document source within this agent-document system (unrelated to the user's resource library uploads). "file" = every non-web agent document (authored or edited as agent documents, plus uploaded originals); "web" = crawled from external URLs; "all" returns both. Web-crawled documents are hidden from the default agent_documents_index — pass sourceType="web" here to see them.`,
            enum: ['all', 'file', 'web'],
            type: 'string',
          },
          titleContains: {
            description:
              'Only list documents whose title contains this text (case-insensitive). Applied before paging, so it finds every match, e.g. all daily reports that share a title prefix.',
            type: 'string',
          },
        },
        required: [],
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
            description: AGENT_DOCUMENT_ID_DESCRIPTION,
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
      "Manage agent-scoped documents and folders (list/create/read/edit/remove/rename/copy/move, create folders) and load rules. Not for the user's uploaded files — use the Knowledge Base tool for those.",
    title: 'Documents',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
