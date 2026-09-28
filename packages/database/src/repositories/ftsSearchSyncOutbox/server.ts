import { serverDB } from '../../core/db-adaptor';
import { FtsSearchSyncOutboxRepository } from '.';

/** Application singleton kept separate so standalone tooling can import the repository class. */
export const ftsSearchSyncOutboxRepository = new FtsSearchSyncOutboxRepository(serverDB);
