import type { LobeTool } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import type { InstalledPluginItem, NewInstalledPlugin } from '../schemas';
import { userInstalledPlugins } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class PluginModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (
    params: Pick<
      NewInstalledPlugin,
      'type' | 'identifier' | 'manifest' | 'customParams' | 'settings' | 'source'
    >,
  ) => {
    const [result] = await this.db
      .insert(userInstalledPlugins)
      .values({ ...params, userId: this.userId })
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
      .where(
        and(eq(userInstalledPlugins.identifier, id), eq(userInstalledPlugins.userId, this.userId)),
      );
  };

  deleteAll = async () => {
    return this.db.delete(userInstalledPlugins).where(eq(userInstalledPlugins.userId, this.userId));
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
      .where(eq(userInstalledPlugins.userId, this.userId))
      .orderBy(desc(userInstalledPlugins.createdAt));

    return data.map<LobeTool>((item) => ({
      ...item,
      runtimeType: item.manifest?.type || 'default',
    }));
  };

  findById = async (id: string) => {
    return this.db.query.userInstalledPlugins.findFirst({
      where: and(
        eq(userInstalledPlugins.identifier, id),
        eq(userInstalledPlugins.userId, this.userId),
      ),
    });
  };

  update = async (id: string, value: Partial<InstalledPluginItem>) => {
    return this.db
      .update(userInstalledPlugins)
      .set({ ...value, updatedAt: new Date() })
      .where(
        and(eq(userInstalledPlugins.identifier, id), eq(userInstalledPlugins.userId, this.userId)),
      );
  };
}
