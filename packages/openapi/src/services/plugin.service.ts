import { PluginModel } from '@/database/models/plugin';
import type { LobeChatDatabase } from '@/database/type';
import { pluginRouter } from '@/server/routers/lambda/plugin';

import { BaseService } from '../common/base.service';
import type { DeletedResource } from '../types/common.type';
import type {
  InstalledPlugin,
  InstallPluginRequest,
  UpdatePluginRequest,
} from '../types/plugin.type';

/**
 * Installed plugins REST service (`user_installed_plugins`).
 *
 * Writes go through the `plugin` tRPC procedures (called server-side), so they
 * keep the same workspace RBAC and creator-only row check as the app. Rows the
 * agent-eval harness installs are not part of the user's inventory and read as
 * missing, as they do in `GET /plugins`.
 */
export class PluginRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string; workspaceRole?: string };
  private readonly pluginModel: PluginModel;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId, workspaceRole };
    this.pluginModel = new PluginModel(db, this.userId, workspaceId);
  }

  private get plugins() {
    return pluginRouter.createCaller(this.ctx);
  }

  private async findPlugin(identifier: string) {
    const row = await this.pluginModel.findById(identifier);
    return row && row.source !== 'agent-eval' ? row : undefined;
  }

  private async requirePlugin(identifier: string): Promise<InstalledPlugin> {
    const row = await this.findPlugin(identifier);
    if (!row) throw this.createNotFoundError('Plugin not found');
    return {
      createdAt: row.createdAt.toISOString(),
      identifier: row.identifier,
      type: row.type,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async installPlugin(request: InstallPluginRequest): Promise<InstalledPlugin> {
    const existing = await this.pluginModel.findById(request.identifier);
    if (existing?.source === 'agent-eval') {
      throw this.createConflictError('Plugin identifier is held by an evaluation install');
    }
    await this.plugins.createOrInstallPlugin(request);
    return this.requirePlugin(request.identifier);
  }

  async updatePlugin(identifier: string, request: UpdatePluginRequest): Promise<InstalledPlugin> {
    await this.requirePlugin(identifier);
    await this.plugins.updatePlugin({ ...request, id: identifier });
    return this.requirePlugin(identifier);
  }

  async uninstallPlugin(identifier: string): Promise<DeletedResource> {
    await this.requirePlugin(identifier);
    await this.plugins.removePlugin({ id: identifier });
    return { deleted: true, id: identifier };
  }
}
