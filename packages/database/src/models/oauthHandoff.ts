import { and, eq, lt, sql } from 'drizzle-orm';

import type { NewOAuthHandoff, OAuthHandoffItem } from '../schemas';
import { oauthHandoffs } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class OAuthHandoffModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Create a new OAuth handoff record
   * @param params Credential data
   * @returns Created record
   */
  create = async (params: NewOAuthHandoff): Promise<OAuthHandoffItem> => {
    const [result] = await this.db
      .insert(oauthHandoffs)
      .values(params)
      .onConflictDoNothing()
      .returning();

    return result;
  };

  /**
   * Fetch and consume OAuth credentials
   * This method queries the record first, and if found, deletes it immediately to ensure credentials can only be used once
   * @param id Credential ID
   * @param client Client type
   * @returns Credential data, or null if it doesn't exist or has expired
   */
  fetchAndConsume = async (id: string, client: string): Promise<OAuthHandoffItem | null> => {
    // First find the record while checking if it's expired (5 minute TTL)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const handoff = await this.db.query.oauthHandoffs.findFirst({
      where: and(
        eq(oauthHandoffs.id, id),
        eq(oauthHandoffs.client, client),
        // Check if the record was created within the last 5 minutes
        sql`${oauthHandoffs.createdAt} > ${fiveMinutesAgo}`,
      ),
    });

    if (!handoff) {
      return null;
    }

    // Immediately delete the record to ensure one-time use
    await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, id));

    return handoff;
  };

  /**
   * Clean up expired OAuth handoff records
   * This method should be called periodically (e.g., via a cron job) to clean up expired records
   * @returns Number of records cleaned up
   */
  cleanupExpired = async (): Promise<number> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const result = await this.db
      .delete(oauthHandoffs)
      .where(lt(oauthHandoffs.createdAt, fiveMinutesAgo));

    return result.rowCount || 0;
  };

  /**
   * Check if a credential exists (without consuming it)
   * Primarily used for testing and debugging
   * @param id Credential ID
   * @param client Client type
   * @returns Whether it exists and is not expired
   */
  exists = async (id: string, client: string): Promise<boolean> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const handoff = await this.db.query.oauthHandoffs.findFirst({
      where: and(
        eq(oauthHandoffs.id, id),
        eq(oauthHandoffs.client, client),
        sql`${oauthHandoffs.createdAt} > ${fiveMinutesAgo}`,
      ),
    });

    return !!handoff;
  };
}
