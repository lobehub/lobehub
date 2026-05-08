import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { KnowledgeBaseApiName, KnowledgeBaseIdentifier } from './types';

export const KnowledgeBaseManifest: BuiltinToolManifest = {
  api: [
    // ---- Resource Library Files (highest priority — most user files live here) ----
    {
      description:
        "List files from the user's resource library. This is where most user-uploaded files live (images, PDFs, documents, etc.). Files here are NOT in any knowledge base yet. Supports filtering by category and search query. **Use this first when the user asks about their files.**",
      name: KnowledgeBaseApiName.listFiles,
      parameters: {
        properties: {
          category: {
            description:
              'Filter by file category. Options: "images", "documents", "audios", "videos", "websites". Omit to list all categories.',
            enum: ['images', 'documents', 'audios', 'videos', 'websites'],
            type: 'string',
          },
          limit: {
            default: 50,
            description: 'Number of files to return per page (default: 50).',
            maximum: 100,
            minimum: 1,
            type: 'number',
          },
          offset: {
            default: 0,
            description: 'Offset for pagination (default: 0).',
            minimum: 0,
            type: 'number',
          },
          q: {
            description: 'Search query to filter files by name.',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Get detailed metadata of a specific file by ID, including name, type, size, URL, and timestamps. Works for any file in the system regardless of knowledge base association.',
      name: KnowledgeBaseApiName.getFileDetail,
      parameters: {
        properties: {
          id: {
            description: 'The file ID to get details for.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    // ---- Knowledge Base Visibility ----
    {
      description:
        'List all knowledge bases available to the current user. Returns name, description, and metadata for each knowledge base. Use this only when the user explicitly asks about knowledge bases.',
      name: KnowledgeBaseApiName.listKnowledgeBases,
      parameters: {
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'View a specific knowledge base and list its files and documents with pagination. Returns the knowledge base metadata along with a page of items.',
      name: KnowledgeBaseApiName.viewKnowledgeBase,
      parameters: {
        properties: {
          id: {
            description: 'The ID of the knowledge base to view.',
            type: 'string',
          },
          limit: {
            default: 50,
            description: 'Number of items to return per page (default: 50, max: 100).',
            maximum: 100,
            minimum: 1,
            type: 'number',
          },
          offset: {
            default: 0,
            description: 'Offset for pagination (default: 0).',
            minimum: 0,
            type: 'number',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    // ---- Search & Read ----
    {
      description:
        'Search the knowledge base. Returns two result types: (1) <files> — uploaded files matched by semantic vector search at chunk-level (file_* IDs); (2) <documents> — inline notes/documents matched by full-text BM25 search at document-level (docs_* IDs). Use this to discover relevant content first, then call readKnowledge with the returned IDs to get full content. Resolve pronouns/references to concrete entities for best vector recall.',
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
        'Read the full content of specific resources from the knowledge base. Accepts both file IDs (file_*) for uploaded files and document IDs (docs_*) for inline documents created via createDocument. Use this after searchKnowledgeBase or viewKnowledgeBase to get complete content. You can read multiple resources at once.',
      name: KnowledgeBaseApiName.readKnowledge,
      parameters: {
        properties: {
          fileIds: {
            description:
              'Array of resource IDs to read. Accepts file IDs (file_*) and document IDs (docs_*) returned by searchKnowledgeBase or viewKnowledgeBase.',
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
