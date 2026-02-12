import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { KnowledgeBaseApiName, KnowledgeBaseIdentifier } from './types';

export const KnowledgeBaseManifest: BuiltinToolManifest = {
  api: [
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
  ],
  identifier: KnowledgeBaseIdentifier,
  meta: {
    avatar: '📚',
    description: 'Search and retrieve information from knowledge bases',
    readme:
      'Search through your knowledge base using semantic vector search to find relevant files and content. Retrieve full documents for in-depth analysis and reference.',
    title: 'Knowledge Base',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
