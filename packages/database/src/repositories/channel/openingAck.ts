import { and, eq, like, sql } from 'drizzle-orm';

import { channelMessages } from '../../schemas';

/**
 * Request keys of the acknowledgements an Agent posts before its run (`openingRequestKey` in
 * `./opening`, which imports the Channel view, so the prefix is repeated here).
 */
const OPENING_REQUEST_KEY_PATTERN = 'opening:%';

/**
 * An Agent's acknowledgement before its run: it says the work started, not what came of it. One
 * a failure turned into the reply's card is news again.
 */
export const isOpeningAck = and(
  eq(channelMessages.routingStatus, 'reply'),
  like(channelMessages.requestKey, OPENING_REQUEST_KEY_PATTERN),
  sql`COALESCE(${channelMessages.metadata} ->> 'replyError', '') = ''`,
);
