export interface ArtifactDeploymentReleaseRef {
  deploymentId: string;
  releaseId: string;
}

/**
 * The URL the signed-in app loads, in a sandboxed iframe, to show one release
 * of a hosted HTML deployment (`dep_…`); undefined without a release. Nothing
 * is hosted in this build, so there is never one, and an artboard cannot pin a
 * board to a deployment here.
 */
export const useArtifactDeploymentPreviewUrl = (
  _release: ArtifactDeploymentReleaseRef | undefined,
): string | undefined => undefined;
