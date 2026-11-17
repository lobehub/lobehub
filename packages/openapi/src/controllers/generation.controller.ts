import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { GenerationRestService } from '../services/generation.service';
import type {
  CreateImageGenerationRequest,
  CreateVideoGenerationRequest,
  GenerationIdParam,
  GenerationListQuery,
} from '../types/generation.type';

/**
 * Image / video generation controller.
 * Handles HTTP concerns only — generation rules live in the shared image / video procedures.
 */
export class GenerationController extends BaseController {
  private async service(c: Context) {
    return new GenerationRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** POST /api/v1/images/generations */
  async createImages(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateImageGenerationRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createImages(body), 'Image generation started');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/videos/generations */
  async createVideo(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateVideoGenerationRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createVideo(body), 'Video generation started', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/generations */
  async listGenerations(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<GenerationListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listGenerations(query), {
        message: 'Generations retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/generations/:id */
  async getGeneration(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GenerationIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getGeneration(id), 'Generation retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/generations/:id */
  async deleteGeneration(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GenerationIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.deleteGeneration(id), 'Generation deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
