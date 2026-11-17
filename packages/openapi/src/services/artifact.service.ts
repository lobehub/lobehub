import { randomUUID } from 'node:crypto';

import { marketDeploymentsRouter } from '@/business/server/lambda-routers/marketDeployments';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type { ArtifactDeploymentResponse, PublishArtifactRequest } from '../types/artifact.type';

interface DeploymentRecord {
  id: string;
  latestRevisionNumber: number;
  publicUrl: string;
  status: ArtifactDeploymentResponse['status'];
  subdomainLabel: string | null;
  title: string | null;
  updatedAt: string;
}

/**
 * `market.deployments.*` only exists on LobeHub Cloud; the OSS router this
 * package compiles against is an empty stub, so the one call is described here
 * (as `lh artifact` does) and reached through a cast.
 */
interface DeploymentCaller {
  publishWorkspaceHtml: (input: {
    artifactIdentifier: string;
    files?: PublishArtifactRequest['files'];
    html: string;
    requestedSlug?: string;
    target: { deploymentId: string; kind: 'deployment' } | { kind: 'create' };
    title?: string;
  }) => Promise<{ data: DeploymentRecord }>;
}

/** Whether this server can publish at all (the cloud router carries the procedure). */
export const canPublishArtifacts = () =>
  'publishWorkspaceHtml' in (marketDeploymentsRouter._def.procedures as Record<string, unknown>);

/**
 * Artifact publishing REST service.
 *
 * Calls the deployment procedure the app and `lh artifact publish` use,
 * server-side, so REST shares its workspace member gate, plan quota and
 * per-owner write lock. The deployment is owned by the caller — or by the
 * workspace's Market organization in a workspace.
 */
export class ArtifactRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  async publish(input: PublishArtifactRequest): Promise<ArtifactDeploymentResponse> {
    if (!canPublishArtifacts()) {
      throw this.createNotFoundError('Artifact publishing is not available on this server');
    }

    const caller = marketDeploymentsRouter.createCaller(this.ctx) as unknown as DeploymentCaller;
    const { data } = await caller.publishWorkspaceHtml({
      artifactIdentifier: input.artifactIdentifier ?? `api:${randomUUID()}`,
      files: input.files,
      html: input.html,
      requestedSlug: input.slug ?? input.title,
      target: input.deploymentId
        ? { deploymentId: input.deploymentId, kind: 'deployment' }
        : { kind: 'create' },
      title: input.title,
    });

    return {
      id: data.id,
      latestRevisionNumber: data.latestRevisionNumber,
      publicUrl: data.publicUrl,
      status: data.status,
      subdomainLabel: data.subdomainLabel ?? null,
      title: data.title ?? null,
      updatedAt: new Date(data.updatedAt).toISOString(),
    };
  }
}
