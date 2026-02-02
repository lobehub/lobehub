import { and, eq, gt, lt } from 'drizzle-orm';

import {
  type McpOauthPendingItem,
  type McpOauthTokensItem,
  type NewMcpOauthPendingItem,
  type NewMcpOauthTokensItem,
  mcpOauthPending,
  mcpOauthTokens,
} from '../schemas';
import { LobeChatDatabase } from '../type';

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class McpOauthModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  // --- Pending ---

  createPending = async (params: NewMcpOauthPendingItem): Promise<McpOauthPendingItem> => {
    const [result] = await this.db.insert(mcpOauthPending).values(params).returning();
    if (!result) throw new Error('Failed to create MCP OAuth pending record');
    return result;
  };

  findPendingByState = async (state: string): Promise<McpOauthPendingItem | null> => {
    const now = new Date();
    const row = await this.db.query.mcpOauthPending.findFirst({
      where: and(eq(mcpOauthPending.state, state), gt(mcpOauthPending.expiresAt, now)),
    });
    return row ?? null;
  };

  consumePending = async (state: string): Promise<McpOauthPendingItem | null> => {
    const row = await this.findPendingByState(state);
    if (!row) return null;
    await this.db.delete(mcpOauthPending).where(eq(mcpOauthPending.state, state));
    return row;
  };

  deleteExpiredPending = async (): Promise<number> => {
    const expired = new Date(Date.now() - PENDING_TTL_MS);
    const result = await this.db
      .delete(mcpOauthPending)
      .where(lt(mcpOauthPending.expiresAt, expired));
    return result.rowCount ?? 0;
  };

  // --- Tokens ---

  upsertTokens = async (params: NewMcpOauthTokensItem): Promise<McpOauthTokensItem> => {
    const [result] = await this.db
      .insert(mcpOauthTokens)
      .values(params)
      .onConflictDoUpdate({
        set: {
          accessToken: params.accessToken,
          clientId: params.clientId,
          expiresAt: params.expiresAt ?? undefined,
          refreshToken: params.refreshToken ?? undefined,
          tokenEndpoint: params.tokenEndpoint,
          updatedAt: new Date(),
        },
        target: [mcpOauthTokens.userId, mcpOauthTokens.pluginIdentifier],
      })
      .returning();
    if (!result) throw new Error('Failed to upsert MCP OAuth tokens');
    return result;
  };

  findTokens = async (
    userId: string,
    pluginIdentifier: string,
  ): Promise<McpOauthTokensItem | null> => {
    const row = await this.db.query.mcpOauthTokens.findFirst({
      where: and(
        eq(mcpOauthTokens.userId, userId),
        eq(mcpOauthTokens.pluginIdentifier, pluginIdentifier),
      ),
    });
    return row ?? null;
  };

  deleteTokens = async (userId: string, pluginIdentifier: string): Promise<number> => {
    const result = await this.db
      .delete(mcpOauthTokens)
      .where(
        and(
          eq(mcpOauthTokens.userId, userId),
          eq(mcpOauthTokens.pluginIdentifier, pluginIdentifier),
        ),
      );
    return result.rowCount ?? 0;
  };

  hasTokens = async (userId: string, pluginIdentifier: string): Promise<boolean> => {
    const row = await this.findTokens(userId, pluginIdentifier);
    return !!row;
  };
}
