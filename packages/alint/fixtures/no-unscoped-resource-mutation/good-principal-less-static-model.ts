// Fixture: a static model taking only `(db, id)` with no principal; the class doc puts
// scoping on its server-side callers.
import { eq } from 'drizzle-orm';

import { type Database, linearConnections } from './schema';

/**
 * CRUD for `linear_connections`. Callers are server-side (the OAuth callback
 * and the settings router), so it exposes static methods taking the db; the
 * row's scope is who the connection belongs to, not the caller's identity.
 */
export class LinearConnectionModel {
  static findById = async (db: Database, id: string) => {
    const [row] = await db.select().from(linearConnections).where(eq(linearConnections.id, id));
    return row ?? null;
  };

  /** Disconnect: drop the token and hide the row. A reconnect reuses it. */
  static revoke = async (db: Database, id: string): Promise<void> => {
    await db
      .update(linearConnections)
      .set({
        credentials: null,
        revokedAt: new Date(),
        tokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(linearConnections.id, id));
  };
}
