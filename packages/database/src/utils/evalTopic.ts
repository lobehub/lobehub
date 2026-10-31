import { sql } from 'drizzle-orm';

import { topics } from '../schemas/topic';

/** Keep synthetic eval dialogue out of the account's automatic Memory history. */
export const notEvalTopic = () => sql`COALESCE(${topics.trigger}, '') <> 'eval'`;
