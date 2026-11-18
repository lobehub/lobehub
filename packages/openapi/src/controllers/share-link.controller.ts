import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ShareLinkRestService } from '../services/share-link.service';
import type { CreateShareLinkRequest, ShareLinkParam } from '../types/share-link.type';

/**
 * Share links controller.
 * Handles HTTP concerns only — each share mechanism keeps its own rules.
 */
export class ShareLinkController extends BaseController {
  private async service(c: Context): Promise<ShareLinkRestService> {
    return new ShareLinkRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/share-links/:resourceType/:resourceId */
  async getShareLink(c: Context): Promise<Response> {
    try {
      const { resourceId, resourceType } = this.getParams<ShareLinkParam>(c);
      return this.success(c, await (await this.service(c)).get(resourceType, resourceId));
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/share-links */
  async createShareLink(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateShareLinkRequest>(c);
      return this.success(c, await (await this.service(c)).enable(body), 'Share link enabled');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/share-links/:resourceType/:resourceId */
  async deleteShareLink(c: Context): Promise<Response> {
    try {
      const { resourceId, resourceType } = this.getParams<ShareLinkParam>(c);
      return this.success(
        c,
        await (await this.service(c)).disable(resourceType, resourceId),
        'Share link disabled',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
