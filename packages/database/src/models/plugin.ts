import type { LobeTool } from '@lobechat/types';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { InstalledPluginItem, NewInstalledPlugin } from '../schemas';
import { userInstalledPlugins } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export class PluginModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      userInstalledPlugins,
    );

  // Legacy evaluation installations are quarantined by server-owned provenance.
  private visible = () =>
    and(this.ownership(), sql`COALESCE(${userInstalledPlugins.source}, '') <> 'agent-eval'`);

  create = async (
    params: Pick<
      NewInstalledPlugin,
      'type' | 'identifier' | 'manifest' | 'customParams' | 'settings' | 'source'
    >,
  ) => {
    return this.db.transaction(async (tx) => {
      // Legacy eval installs share this table's (userId, identifier) primary key.
      // Move only their storage key aside; keep the manifest, address and auth intact.
      // Model-facing identifiers live in the frozen contract, independently of this key.
      if (params.source !== 'agent-eval') {
        await tx
          .update(userInstalledPlugins)
          .set({ identifier: `agent-eval:${crypto.randomUUID()}` })
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              eq(userInstalledPlugins.identifier, params.identifier),
              eq(userInstalledPlugins.source, 'agent-eval'),
            ),
          );
      }
      const [result] = await tx
        .insert(userInstalledPlugins)
        .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
        .onConflictDoUpdate({
          set: { ...params, updatedAt: new Date() },
          target: [userInstalledPlugins.identifier, userInstalledPlugins.userId],
        })
        .returning();
      return result;
    });
  };

  delete = async (id: string) => {
    return this.db
      .delete(userInstalledPlugins)
      .where(and(eq(userInstalledPlugins.identifier, id), this.visible()));
  };

  deleteAll = async () => {
    return this.db.delete(userInstalledPlugins).where(this.ownership());
  };

  query = async () => {
    const data = await this.db
      .select({
        createdAt: userInstalledPlugins.createdAt,
        customParams: userInstalledPlugins.customParams,
        identifier: userInstalledPlugins.identifier,
        manifest: userInstalledPlugins.manifest,
        settings: userInstalledPlugins.settings,
        source: userInstalledPlugins.type,
        type: userInstalledPlugins.type,
        updatedAt: userInstalledPlugins.updatedAt,
      })
      .from(userInstalledPlugins)
      .where(this.visible())
      .orderBy(desc(userInstalledPlugins.createdAt));

    return data.map<LobeTool>((item) => ({
      ...item,
      runtimeType: item.manifest?.type || 'default',
    }));
  };

  findById = async (id: string) => {
    return this.db.query.userInstalledPlugins.findFirst({
      where: and(eq(userInstalledPlugins.identifier, id), this.visible()),
    });
  };

  update = async (id: string, value: Partial<InstalledPluginItem>) => {
    return this.db
      .update(userInstalledPlugins)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(userInstalledPlugins.identifier, id), this.visible()));
  };
}
