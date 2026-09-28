import type { LobeChatDatabase } from '../../../type';
import { PostgresFtsSearchBackend } from '../postgres/backend';
import type { FtsSearchBackendScope } from '../types';
import { pgSearchDialect } from './dialect';

/** ParadeDB adapter over the shared PostgreSQL query layer. */
export class PgSearchFtsSearchBackend extends PostgresFtsSearchBackend {
  readonly key = 'pg_search';

  constructor(db: LobeChatDatabase, scope: FtsSearchBackendScope) {
    super(db, scope, pgSearchDialect);
  }
}
