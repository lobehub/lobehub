import { serverDB } from '../../core/server-db';
import { FtsSearchSyncOutboxRepository } from '.';

/** Application singleton kept separate so standalone tooling can import the repository class. */
export const ftsSearchSyncOutboxRepository = new FtsSearchSyncOutboxRepository(serverDB);
