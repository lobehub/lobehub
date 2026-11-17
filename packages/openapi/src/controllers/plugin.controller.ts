import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { PluginRestService } from '../services/plugin.service';
import type { InstallPluginRequest, UpdatePluginRequest } from '../types/plugin.type';

export class PluginController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new PluginRestService(
      db,
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole') || undefined,
    );
  }

  async installPlugin(c: Context) {
    try {
      const body = await this.getBody<InstallPluginRequest>(c);
      return this.success(
        c,
        await (await this.getService(c)).installPlugin(body),
        'Plugin installed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updatePlugin(c: Context) {
    try {
      const { identifier } = this.getParams<{ identifier: string }>(c);
      const body = await this.getBody<UpdatePluginRequest>(c);
      return this.success(
        c,
        await (await this.getService(c)).updatePlugin(identifier, body),
        'Plugin updated',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async uninstallPlugin(c: Context) {
    try {
      const { identifier } = this.getParams<{ identifier: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).uninstallPlugin(identifier),
        'Plugin uninstalled',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
