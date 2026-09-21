import type { LobeChatDatabase } from '../../../type';
import type {
  FtsSearchBackend,
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
  FtsSearchBackendScope,
} from '../types';
import {
  searchAgents,
  searchChatGroups,
  searchFiles,
  searchKnowledgeBases,
  searchMessages,
  searchTopics,
} from './command-menu';
import type { PostgresFtsSearchContext } from './context';
import { createPostgresFtsSearchContext } from './context';
import type { PostgresFtsSearchDialect } from './dialect';
import { searchFolders, searchKnowledgeBaseDocuments, searchPages } from './documents';
import { searchMemories } from './memories';

/**
 * Product search over the shared PostgreSQL query modules. Each subclass only
 * supplies the dialect; query shape, permissions, and hydration stay identical.
 */
export abstract class PostgresFtsSearchBackend implements FtsSearchBackend {
  abstract readonly key: string;

  protected readonly context: PostgresFtsSearchContext;

  protected constructor(
    db: LobeChatDatabase,
    scope: FtsSearchBackendScope,
    dialect: PostgresFtsSearchDialect,
  ) {
    this.context = createPostgresFtsSearchContext(db, scope, dialect);
  }

  async search(request: FtsSearchBackendRequest): Promise<FtsSearchBackendResponse> {
    const query = request.query.text.trim();
    if (!query) return { candidates: [], items: [] };

    const { entity, filters, pagination } = request;
    const limit = pagination.limit;
    if (!limit) throw new Error(`${this.key} product search requires a positive limit`);

    if (entity === 'agents') return searchAgents(this.context, query, limit);
    if (entity === 'chatGroups') return searchChatGroups(this.context, query, limit);
    if (entity === 'topics') return searchTopics(this.context, query, limit, filters.agentId);
    if (entity === 'messages') return searchMessages(this.context, query, limit, filters.agentId);
    if (entity === 'files') {
      return searchFiles(this.context, query, limit, filters.excludeKnowledgeBaseIds);
    }
    if (entity === 'knowledgeBases') {
      return searchKnowledgeBases(this.context, query, limit, filters.excludeKnowledgeBaseIds);
    }
    if (entity === 'userMemories') return searchMemories(this.context, query, limit);

    if (entity === 'documents') {
      if (filters.documentKind === 'folder') {
        return searchFolders(this.context, query, limit, filters.excludeKnowledgeBaseIds);
      }
      if (filters.documentKind === 'page') {
        return searchPages(this.context, query, limit, filters.excludeKnowledgeBaseIds);
      }
      if (filters.documentKind === 'knowledgeBaseDocument') {
        return searchKnowledgeBaseDocuments(
          this.context,
          query,
          filters.knowledgeBaseIds ?? [],
          limit,
        );
      }
    }

    throw new Error(`Unsupported ${this.key} entity: ${entity}`);
  }
}
