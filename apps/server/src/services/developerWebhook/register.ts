import { getServerDB } from '@/database/core/db-adaptor';
import { setDatabaseEventListener } from '@/database/events';

import { publishWebhookEvent } from './emit';

/**
 * Route the data layer's domain events (`@/database/events`) to developer webhooks.
 * Imported for its side effect by every server entry that writes through the models;
 * registering twice is harmless.
 *
 * The emitting model may hold a transaction that is closed by the time the event is
 * published after the response, so publishing always uses the server's own handle.
 */
setDatabaseEventListener((_db, scope, type, data) => {
  void getServerDB()
    .then((db) => publishWebhookEvent(db, scope, type, data))
    .catch((error) => console.error(`[developerWebhook] cannot publish ${type}`, error));
});
