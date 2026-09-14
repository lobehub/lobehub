import type { LobeChatDatabase } from '../../type';
import { PostgresFtsSearchBackend } from './pgSearch';
import { searchCandidates } from './pgSearch/candidates';
import { pgLikeDialect } from './pgSearch/dialect';
import type {
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
  FtsSearchBackendScope,
} from './types';

/**
 * Extension-free PostgreSQL provider built on `ILIKE` substring matching.
 *
 * It is an explicit deployment choice for small self-hosted instances and preview
 * environments, never an implicit fallback: it runs on any PostgreSQL without
 * `pg_search` or Elasticsearch, serves the same product entities through the shared
 * query modules, and also answers candidate-only requests so no model path needs
 * ParadeDB operators.
 */
export class PgLikeFtsSearchBackend extends PostgresFtsSearchBackend {
  readonly key = 'pg_like';

  constructor(db: LobeChatDatabase, scope: FtsSearchBackendScope) {
    super(db, scope, pgLikeDialect);
  }

  async search(request: FtsSearchBackendRequest): Promise<FtsSearchBackendResponse> {
    if (request.mode === 'candidates') {
      if (!request.query.text.trim()) return { candidates: [], items: [], total: 0 };

      return searchCandidates(this.context, request);
    }

    return super.search(request);
  }
}
