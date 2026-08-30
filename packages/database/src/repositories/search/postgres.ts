import type { LobeChatDatabase } from '../../type';
import {
  searchAgents,
  searchChatGroups,
  searchFiles,
  searchKnowledgeBases,
  searchMessages,
  searchTopics,
} from './postgres/command-menu';
import { searchFolders, searchKnowledgeBaseDocuments, searchPages } from './postgres/documents';
import { searchMemories } from './postgres/memories';
import type { PostgresSearchContext } from './postgres/scope';
import { createPostgresSearchContext } from './postgres/scope';
import type {
  SearchBackend,
  SearchBackendRequest,
  SearchBackendResponse,
  SearchBackendScope,
} from './types';

/** PostgreSQL/pg_search adapter that preserves the existing query and hydration shape. */
export class PostgresSearchBackend implements SearchBackend {
  readonly key = 'pg_search';

  private readonly context: PostgresSearchContext;

  constructor(db: LobeChatDatabase, scope: SearchBackendScope) {
    this.context = createPostgresSearchContext(db, scope);
  }

  async search(request: SearchBackendRequest): Promise<SearchBackendResponse> {
    const query = request.query.text.trim();
    if (!query) return { candidates: [], items: [] };

    const { entity, filters, pagination } = request;
    const limit = pagination.limit;
    if (!limit) throw new Error('pg_search product search requires a positive limit');

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

    throw new Error(`Unsupported pg_search entity: ${entity}`);
  }
}
