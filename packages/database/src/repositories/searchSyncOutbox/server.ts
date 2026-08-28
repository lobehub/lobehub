import { serverDB } from '../../core/db-adaptor';
import { SearchSyncOutboxRepository } from '.';

/** Application singleton kept separate so standalone tooling can import the repository class. */
export const searchSyncOutboxRepository = new SearchSyncOutboxRepository(serverDB);
