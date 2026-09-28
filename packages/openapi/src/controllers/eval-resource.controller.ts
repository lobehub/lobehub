import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { EvalResourceService } from '../services/eval-resource.service';
import type {
  CreateBenchmark,
  CreateDataset,
  CreateTestCase,
  EvalPagination,
} from '../types/eval-resource.type';

export class EvalResourceController extends BaseController {
  async listBenchmarks(c: Context) {
    try {
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.listBenchmarks(this.getQuery<EvalPagination>(c)),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async getBenchmark(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.getBenchmark(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async createBenchmark(c: Context) {
    try {
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.createBenchmark((await this.getBody<CreateBenchmark>(c))!),
        'Eval resource retrieved',
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async updateBenchmark(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.updateBenchmark(id, (await this.getBody<Partial<CreateBenchmark>>(c))!),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async deleteBenchmark(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.deleteBenchmark(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async listDatasets(c: Context) {
    try {
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.listDatasets(this.getQuery<EvalPagination & { benchmarkId?: string }>(c)),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async getDataset(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.getDataset(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async createDataset(c: Context) {
    try {
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.createDataset((await this.getBody<CreateDataset>(c))!),
        'Eval resource retrieved',
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async updateDataset(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.updateDataset(id, (await this.getBody<Partial<CreateDataset>>(c))!),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async deleteDataset(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.deleteDataset(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async listTestCases(c: Context) {
    try {
      const { datasetId } = this.getParams<{ datasetId: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.listTestCases(datasetId, this.getQuery<EvalPagination>(c)),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async getTestCase(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.getTestCase(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async createTestCase(c: Context) {
    try {
      const { datasetId } = this.getParams<{ datasetId: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.createTestCase(datasetId, (await this.getBody<CreateTestCase>(c))!),
        'Eval resource retrieved',
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async updateTestCase(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.updateTestCase(id, (await this.getBody<Partial<CreateTestCase>>(c))!),
        'Eval resource retrieved',
        200,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async deleteTestCase(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = new EvalResourceService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.deleteTestCase(id), 'Eval resource retrieved', 200);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
