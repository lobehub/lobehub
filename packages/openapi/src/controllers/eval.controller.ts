import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { EvalService } from '../services/eval.service';
import type { CreateEvalRunRequest } from '../types/eval.type';

export class EvalController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new EvalService(db, this.getUserId(c)!, this.getWorkspaceId(c));
  }

  async createRun(c: Context) {
    try {
      const request = (await this.getBody<CreateEvalRunRequest>(c))!;
      const run = await (await this.getService(c)).createRun(request);
      return this.success(c, run, 'Eval run accepted', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getRun(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(c, await (await this.getService(c)).getRun(id), 'Eval run retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getRunResults(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).getRunResults(id),
        'Eval results retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
