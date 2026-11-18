import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { DashboardRestService } from '../services/dashboard.service';
import type { DashboardListQuery } from '../types/dashboard.type';

type Params = { id: string; itemId: string };

/**
 * Dashboards controller.
 * Handles HTTP concerns only — the board rules live in the shared `dashboard` procedures.
 */
export class DashboardController extends BaseController {
  private async service(c: Context) {
    return new DashboardRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async respond<T>(
    c: Context,
    work: (service: DashboardRestService, params: Params) => Promise<T>,
    message: string,
    status = 200,
  ): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, await work(service, this.getParams<Params>(c)), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listDashboards(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<DashboardListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listDashboards(query), {
        message: 'Dashboards retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createDashboard(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s) => s.createDashboard(body), 'Dashboard created', 201);
  }

  async getDashboard(c: Context) {
    return this.respond(c, (s, p) => s.getDashboard(p.id), 'Dashboard retrieved');
  }

  async updateDashboard(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateDashboard(p.id, body), 'Dashboard updated');
  }

  async deleteDashboard(c: Context) {
    return this.respond(c, (s, p) => s.deleteDashboard(p.id), 'Dashboard deleted');
  }

  async addItem(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.addItem(p.id, body), 'Widget placed', 201);
  }

  async removeItem(c: Context) {
    return this.respond(c, (s, p) => s.removeItem(p.id, p.itemId), 'Widget removed from dashboard');
  }

  async updateLayout(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateLayout(p.id, body), 'Layout saved');
  }
}
