import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { KnowledgeBaseApiName, KnowledgeBaseIdentifier } from './types';

export const KnowledgeBaseManifest: BuiltinToolManifest = {
  api: [
    // ---- P0: Visibility ----
    {
      description:
        'List all knowledge bases available to the current user. Returns name, description, and metadata for each knowledge base. Use this to discover what knowledge bases exist before searching or managing them.',
      name: KnowledgeBaseApiName.listKnowledgeBases,
      parameters: {
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'View a specific knowledge base and list all its files and documents. Returns the knowledge base metadata along with a paginated list of all items (files, documents, folders) it contains.',
      name: KnowledgeBaseApiName.viewKnowledgeBase,
      parameters: {
        properties: {
          id: {
            description: 'The ID of the knowledge base to view.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    // ---- Search & Read ----
    {
      description:
        'Search through knowledge base using semantic vector search to find relevant files and chunks. Returns a summary of matching files with their relevance scores and brief excerpts. Use this first to discover which files contain relevant information. IMPORTANT: Since this uses vector-based search, always resolve pronouns and references to concrete entities (e.g., use "authentication system" instead of "it").',
      name: KnowledgeBaseApiName.searchKnowledgeBase,
      parameters: {
        properties: {
          query: {
            description:
              'The search query to find relevant information. Be specific and use concrete entities. IMPORTANT: Resolve all pronouns and references (like "it", "that", "this") to actual entity names before searching, as this uses semantic vector search which works best with concrete terms.',
            type: 'string',
          },
          topK: {
            default: 15,
            description:
              'Number of top relevant chunks to return (default: 15). Each file will include the most relevant chunks.',
            maximum: 100,
            minimum: 5,
            type: 'number',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description:
        'Read the full content of specific files from the knowledge base. Use this after searchKnowledgeBase to get complete information from relevant files. You can read multiple files at once.',
      name: KnowledgeBaseApiName.readKnowledge,
      parameters: {
        properties: {
          fileIds: {
            description:
              'Array of file IDs to read. Get these IDs from searchKnowledgeBase results.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['fileIds'],
        type: 'object',
      },
    },
    // ---- P1: Management ----
    {
      description:
        'Create a new knowledge base. Returns the ID of the newly created knowledge base.',
      name: KnowledgeBaseApiName.createKnowledgeBase,
      parameters: {
        properties: {
          description: {
            description: 'Optional description of the knowledge base.',
            type: 'string',
          },
          name: {
            description: 'Name of the knowledge base to create.',
            type: 'string',
          },
        },
        required: ['name'],
        type: 'object',
      },
    },
    {
      description:
        'Delete a knowledge base by ID. This will remove the knowledge base and its file associations. Use with caution.',
      name: KnowledgeBaseApiName.deleteKnowledgeBase,
      parameters: {
        properties: {
          id: {
            description: 'The ID of the knowledge base to delete.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Create a new text/markdown document directly inside a knowledge base. This is useful for adding notes, summaries, or any text content without uploading a file.',
      name: KnowledgeBaseApiName.createDocument,
      parameters: {
        properties: {
          content: {
            description: 'The text or markdown content of the document.',
            type: 'string',
          },
          knowledgeBaseId: {
            description: 'The ID of the knowledge base to create the document in.',
            type: 'string',
          },
          parentId: {
            description: 'Optional parent folder ID. Omit to place at root level.',
            type: 'string',
          },
          title: {
            description: 'Title of the document.',
            type: 'string',
          },
        },
        required: ['knowledgeBaseId', 'title', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Add existing files to a knowledge base by their file IDs. The files must already exist in the system.',
      name: KnowledgeBaseApiName.addFiles,
      parameters: {
        properties: {
          fileIds: {
            description: 'Array of file IDs to add to the knowledge base.',
            items: { type: 'string' },
            type: 'array',
          },
          knowledgeBaseId: {
            description: 'The ID of the knowledge base to add files to.',
            type: 'string',
          },
        },
        required: ['knowledgeBaseId', 'fileIds'],
        type: 'object',
      },
    },
    {
      description:
        'Remove files from a knowledge base by their file IDs. This only removes the association; the files themselves are not deleted.',
      name: KnowledgeBaseApiName.removeFiles,
      parameters: {
        properties: {
          fileIds: {
            description: 'Array of file IDs to remove from the knowledge base.',
            items: { type: 'string' },
            type: 'array',
          },
          knowledgeBaseId: {
            description: 'The ID of the knowledge base to remove files from.',
            type: 'string',
          },
        },
        required: ['knowledgeBaseId', 'fileIds'],
        type: 'object',
      },
    },
  ],
  identifier: KnowledgeBaseIdentifier,
  meta: {
    avatar: '📚',
    description:
      'Search uploaded documents and domain knowledge via semantic vector search — for persistent, reusable reference',
    title: 'Knowledge Base',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
