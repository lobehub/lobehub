import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ArtifactRestService } from '../services/artifact.service';
import type { PublishArtifactRequest } from '../types/artifact.type';

/**
 * Artifacts controller.
 * Handles HTTP concerns only — publishing lives in the shared deployment procedures.
 */
export class ArtifactController extends BaseController {
  /** POST /api/v1/artifacts */
  async publish(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<PublishArtifactRequest>(c);
      const service = new ArtifactRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.publish(body), 'Artifact published', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
