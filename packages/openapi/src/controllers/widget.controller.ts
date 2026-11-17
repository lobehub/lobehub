import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { WidgetRestService } from '../services/widget.service';
import type { WidgetListQuery, WidgetRunListQuery } from '../types/widget.type';

type Params = { id: string; runId: string; versionId: string };

/**
 * Widgets controller.
 * Handles HTTP concerns only — the widget rules live in the shared `widget` procedures.
 */
export class WidgetController extends BaseController {
  private async service(c: Context) {
    return new WidgetRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async respond<T>(
    c: Context,
    work: (service: WidgetRestService, params: Params) => Promise<T>,
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

  async listWidgets(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<WidgetListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listWidgets(query), {
        message: 'Widgets retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createWidget(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s) => s.createWidget(body), 'Widget created', 201);
  }

  async getWidget(c: Context) {
    return this.respond(c, (s, p) => s.getWidget(p.id), 'Widget retrieved');
  }

  async updateWidget(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateWidget(p.id, body), 'Widget updated');
  }

  async deleteWidget(c: Context) {
    return this.respond(c, (s, p) => s.deleteWidget(p.id), 'Widget deleted');
  }

  async saveDraft(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.saveDraft(p.id, body), 'Draft saved', 201);
  }

  async listVersions(c: Context) {
    return this.respond(c, (s, p) => s.listVersions(p.id), 'Widget versions retrieved');
  }

  async getVersion(c: Context) {
    return this.respond(c, (s, p) => s.getVersion(p.id, p.versionId), 'Widget version retrieved');
  }

  async dryRun(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.dryRun(p.id, body), 'Dry run finished');
  }

  async publish(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.publish(p.id, body), 'Version published');
  }

  async run(c: Context) {
    return this.respond(c, (s, p) => s.run(p.id), 'Run finished');
  }

  async listRuns(c: Context) {
    const query = this.getQuery<WidgetRunListQuery>(c);
    return this.respond(c, (s, p) => s.listRuns(p.id, query), 'Widget runs retrieved');
  }

  async getRun(c: Context) {
    return this.respond(c, (s, p) => s.getRun(p.id, p.runId), 'Widget run retrieved');
  }

  async updateSchedule(c: Context) {
    const body = await this.getBody(c);
    return this.respond(c, (s, p) => s.updateSchedule(p.id, body), 'Schedule saved');
  }
}
