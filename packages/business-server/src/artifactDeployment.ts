import type { LobeChatDatabase } from '@lobechat/database';

/**
 * Hosted HTML deployments (`dep_…`, published with `lh artifact publish`) live
 * with the hosting service, not in this database. An artboard board can show
 * one pinned at a release; these seams reach that service. Nothing is hosted
 * here, so every lookup reports the feature as unavailable.
 */

interface ArtifactDeploymentScope {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export interface ArtifactDeploymentRelease {
  deploymentId: string;
  releaseId: string;
  revision: number;
  title: string | null;
}

export type ResolveArtifactDeploymentReleaseResult =
  | { release: ArtifactDeploymentRelease; status: 'ok' }
  /** The deployment exists but has no release with the requested revision. */
  | { latestRevision: number; status: 'revision_not_found' }
  /** Missing, or not visible to the caller. */
  | { status: 'not_found' }
  /** The deployment does not hold a single HTML page (for example a shared document). */
  | { status: 'not_html' }
  /** This build hosts no deployments. */
  | { status: 'unavailable' };

export interface ResolveArtifactDeploymentReleaseParams extends ArtifactDeploymentScope {
  deploymentId: string;
  /** Defaults to the latest release. */
  revision?: number;
}

export const resolveArtifactDeploymentRelease = async (
  _params: ResolveArtifactDeploymentReleaseParams,
): Promise<ResolveArtifactDeploymentReleaseResult> => ({ status: 'unavailable' });

export interface ArtifactDeploymentReleaseRef {
  deploymentId: string;
  releaseId: string;
}

/** The release's HTML, for copying into a published artboard. */
export const readArtifactDeploymentRelease = async (
  _params: ArtifactDeploymentReleaseRef & ArtifactDeploymentScope,
): Promise<string | undefined> => undefined;
