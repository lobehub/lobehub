import type { LobeTool } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

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

  create = async (
    params: Pick<
      NewInstalledPlugin,
      'type' | 'identifier' | 'manifest' | 'customParams' | 'settings' | 'source'
    >,
  ) => {
    const [result] = await this.db
      .insert(userInstalledPlugins)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .onConflictDoUpdate({
        set: { ...params, updatedAt: new Date() },
        target: [userInstalledPlugins.identifier, userInstalledPlugins.userId],
      })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(userInstalledPlugins)
      .where(and(eq(userInstalledPlugins.identifier, id), this.ownership()));
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
      .where(this.ownership())
      .orderBy(desc(userInstalledPlugins.createdAt));

    return data.map<LobeTool>((item) => ({
      ...item,
      runtimeType: item.manifest?.type || 'default',
    }));
  };

  findById = async (id: string) => {
    return this.db.query.userInstalledPlugins.findFirst({
      where: and(eq(userInstalledPlugins.identifier, id), this.ownership()),
    });
  };

  update = async (id: string, value: Partial<InstalledPluginItem>) => {
    return this.db
      .update(userInstalledPlugins)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(userInstalledPlugins.identifier, id), this.ownership()));
  };
}
