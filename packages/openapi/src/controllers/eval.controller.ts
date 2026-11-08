import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { requireApiKeyScope } from '../middleware/permission-check';
import { EvalService } from '../services/eval.service';
import { EvalLifecycleService } from '../services/eval-lifecycle.service';
import type {
  CreateEvalRunRequest,
  EvalBatchReport,
  EvalDatasetListQuery,
  EvalReport,
  EvalRunListQuery,
  EvalRunTopicListQuery,
  EvalSetStatus,
} from '../types/eval.type';

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

  async listRuns(c: Context) {
    try {
      const query = this.getQuery<EvalRunListQuery>(c);
      return this.success(
        c,
        await (await this.getService(c)).listRuns(query),
        'Eval runs retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listDatasets(c: Context) {
    try {
      const query = this.getQuery<EvalDatasetListQuery>(c);
      return this.success(
        c,
        await (await this.getService(c)).listDatasets(query),
        'Eval datasets retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getDataset(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).getDataset(id),
        'Eval dataset retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getRunTopics(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const query = this.getQuery<EvalRunTopicListQuery>(c);
      return this.success(
        c,
        await (await this.getService(c)).getRunTopics(id, query),
        'Eval run topics retrieved',
      );
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
        await (await this.getService(c)).getRunResults(id, this.getQuery<EvalRunTopicListQuery>(c)),
        'Eval results retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async claim(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalLifecycleService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.claim(id));
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async setStatus(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalLifecycleService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.setStatus(id, (await this.getBody<EvalSetStatus>(c))!));
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async retryErrors(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalLifecycleService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      if (await service.requiresInternalExecution(id)) {
        await requireApiKeyScope('model:invoke')(c, async () => {});
        await requireApiKeyScope('chat:write')(c, async () => {});
      }
      return this.success(c, await service.retryErrors(id));
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async report(c: Context) {
    try {
      const { runId, topicId } = this.getParams<{ runId: string; topicId: string }>(c);
      const service = new EvalLifecycleService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.report(runId, topicId, (await this.getBody<EvalReport>(c))!),
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async reportBatch(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalLifecycleService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.reportBatch(id, (await this.getBody<EvalBatchReport>(c))!),
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
