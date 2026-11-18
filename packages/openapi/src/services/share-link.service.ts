import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import { marketDeploymentsRouter } from '@/business/server/lambda-routers/marketDeployments';
import { pageShareRouter } from '@/business/server/lambda-routers/pageShare';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { agentShareRouter } from '@/server/routers/lambda/agentShare';
import { topicRouter } from '@/server/routers/lambda/topic';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type {
  CreateShareLinkRequest,
  ShareLink,
  ShareLinkResourceType,
} from '../types/share-link.type';

/**
 * Page and artifact publishing are implemented by the cloud business layer,
 * and agent sharing is switched off outside it (`assertAgentShareVisitorEnabled`).
 */
const CLOUD_ONLY: ReadonlySet<ShareLinkResourceType> = new Set(['agent', 'artifact', 'page']);

const publicUrl = (path: string) =>
  appEnv.APP_URL ? new URL(path, appEnv.APP_URL).toString() : null;

/**
 * Share links REST service.
 *
 * One shape over four share mechanisms, each through the tRPC procedures the
 * web share popovers call, so ownership, workspace General Access, the
 * agent's topic-share policy, the agent-share feature flag and audit entries
 * are enforced exactly as in the app:
 * - topic    → `topic.getShareInfo` / `enableSharing` / `updateShareVisibility` / `disableSharing`
 * - agent    → `agentShare.getShareStatus` / `enableShare` / `updateVisibility` / `disableShare`
 * - page     → `pageShare.getShareSettings` / `updateShareSettings` (cloud)
 * - artifact → `marketDeployments.getById` / `publishArtifact` / `unpublish` (cloud)
 */
export class ShareLinkRestService extends BaseService {
  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    private readonly businessFeatures: boolean = ENABLE_BUSINESS_FEATURES,
  ) {
    super(db, userId, workspaceId);
  }

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private assertAvailable(resourceType: ShareLinkResourceType) {
    if (CLOUD_ONLY.has(resourceType) && !this.businessFeatures) {
      throw new ApiException(
        501,
        'feature_unavailable',
        `${resourceType.charAt(0).toUpperCase()}${resourceType.slice(1)} sharing is not available on this deployment`,
      );
    }
  }

  async get(resourceType: ShareLinkResourceType, resourceId: string): Promise<ShareLink> {
    this.assertAvailable(resourceType);

    switch (resourceType) {
      case 'topic': {
        // Reading a link needs the topic itself to be visible to the caller,
        // as enabling and disabling do: a missing or foreign topic is 404, not
        // an empty `enabled: false` link.
        const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findOwnTopicById(
          resourceId,
        );
        if (!topic) throw this.createNotFoundError('Topic not found');
        return this.topicLink(resourceId);
      }
      case 'agent': {
        return this.agentLink(resourceId);
      }
      case 'page': {
        return this.pageLink(resourceId);
      }
      case 'artifact': {
        const { data } = await marketDeploymentsRouter
          .createCaller(this.ctx)
          .getById({ id: resourceId });
        return this.artifactLink(data);
      }
    }
  }

  async enable(body: CreateShareLinkRequest): Promise<ShareLink> {
    this.assertAvailable(body.resourceType);

    switch (body.resourceType) {
      case 'topic': {
        const topics = topicRouter.createCaller(this.ctx);
        const existing = await topics.getShareInfo({ topicId: body.resourceId });
        if (existing) {
          await topics.updateShareVisibility({ topicId: body.resourceId, visibility: 'link' });
        } else {
          await topics.enableSharing({ topicId: body.resourceId, visibility: 'link' });
        }
        return this.topicLink(body.resourceId);
      }
      case 'agent': {
        const shares = agentShareRouter.createCaller(this.ctx);
        const existing = await shares.getShareStatus({ agentId: body.resourceId });
        if (existing) {
          await shares.updateVisibility({ agentId: body.resourceId, visibility: 'link' });
        } else {
          await shares.enableShare({ agentId: body.resourceId, visibility: 'link' });
        }
        return this.agentLink(body.resourceId);
      }
      case 'page': {
        await pageShareRouter
          .createCaller(this.ctx)
          .updateShareSettings({ id: body.resourceId, permission: 'read', visibility: 'link' });
        return this.pageLink(body.resourceId);
      }
      case 'artifact': {
        const { data } = await marketDeploymentsRouter.createCaller(this.ctx).publishArtifact({
          artifactIdentifier: body.artifactIdentifier,
          messageId: body.messageId,
          requestedSlug: body.slug,
          topicId: body.topicId,
        });
        return this.artifactLink(data);
      }
    }
  }

  async disable(resourceType: ShareLinkResourceType, resourceId: string): Promise<ShareLink> {
    this.assertAvailable(resourceType);

    switch (resourceType) {
      case 'topic': {
        await topicRouter.createCaller(this.ctx).disableSharing({ topicId: resourceId });
        return this.topicLink(resourceId);
      }
      case 'agent': {
        const shares = agentShareRouter.createCaller(this.ctx);
        // Pausing an agent share keeps its id and slug for a later re-enable.
        if (await shares.getShareStatus({ agentId: resourceId })) {
          await shares.disableShare({ agentId: resourceId });
        }
        return this.agentLink(resourceId);
      }
      case 'page': {
        const shares = pageShareRouter.createCaller(this.ctx);
        // Unsharing a page that was never shared must not create a share record.
        if (await shares.getShareSettings({ id: resourceId })) {
          await shares.updateShareSettings({
            id: resourceId,
            permission: 'read',
            visibility: 'private',
          });
        }
        return this.pageLink(resourceId);
      }
      case 'artifact': {
        const { data } = await marketDeploymentsRouter
          .createCaller(this.ctx)
          .unpublish({ id: resourceId });
        return this.artifactLink(data);
      }
    }
  }

  // ==================== Per-type projections ====================

  private async topicLink(topicId: string): Promise<ShareLink> {
    const share = await topicRouter.createCaller(this.ctx).getShareInfo({ topicId });
    return {
      enabled: share?.visibility === 'link',
      resourceId: topicId,
      resourceType: 'topic',
      shareId: share?.id ?? null,
      url: share ? publicUrl(`/share/t/${share.id}`) : null,
      viewCount: null,
    };
  }

  private async agentLink(agentId: string): Promise<ShareLink> {
    const share = await agentShareRouter.createCaller(this.ctx).getShareStatus({ agentId });
    const slug = share?.shareConfig?.slug;
    return {
      enabled: share?.visibility === 'link',
      resourceId: agentId,
      resourceType: 'agent',
      shareId: share?.id ?? null,
      url: share ? publicUrl(`/a/${slug || share.id}`) : null,
      viewCount: share?.userViewCount ?? null,
    };
  }

  private async pageLink(documentId: string): Promise<ShareLink> {
    const share = await pageShareRouter.createCaller(this.ctx).getShareSettings({ id: documentId });
    return {
      enabled: share?.visibility === 'link',
      resourceId: documentId,
      resourceType: 'page',
      shareId: share ? documentId : null,
      url: share ? publicUrl(`/share/page/${documentId.replace(/^docs_/, '')}`) : null,
      viewCount: share?.pageViewCount ?? null,
    };
  }

  private artifactLink(deployment: { id: string; publicUrl: string; status: string }): ShareLink {
    return {
      enabled: deployment.status === 'active' || deployment.status === 'building',
      resourceId: deployment.id,
      resourceType: 'artifact',
      shareId: deployment.id,
      url: deployment.publicUrl || null,
      viewCount: null,
    };
  }
}
