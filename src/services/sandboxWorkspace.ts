import { lambdaClient } from '@/libs/trpc/client';

/**
 * Renderer-side data layer for the persistent cloud-sandbox workspace.
 *
 * Every path is relative to the workspace root (`reports/q3.md`); the absolute
 * mount path stays server-side, so there is nothing here for a caller to point
 * outside the workspace with.
 *
 * `topicId` is an optimization, not a scope: the workspace belongs to the user,
 * not the topic, but the volume is only reachable from inside a sandbox
 * session, so naming the topic the user is already talking to reuses that warm
 * session instead of cold-starting a second sandbox to list a directory.
 */
class SandboxWorkspaceService {
  /**
   * Environments the caller has, each joined with the snapshot the execution
   * plane holds. A brand-new environment has no snapshot yet — that is normal,
   * not an error, and the UI shows it as unused rather than missing.
   *
   * Reaching the snapshot store needs a live sandbox session, so this can take
   * seconds on a cold start and callers should render a loading state.
   */
  listEnvironments = async (params: { topicId?: string } = {}) =>
    lambdaClient.sandboxWorkspace.listEnvironments.query(params);

  createEnvironment = async (params: { description?: string; name: string }) =>
    lambdaClient.sandboxWorkspace.createEnvironment.mutate(params);

  /** Rename or re-describe. The identifier the snapshot lives under never moves. */
  renameEnvironment = async (params: { description?: string; id: string; name?: string }) =>
    lambdaClient.sandboxWorkspace.renameEnvironment.mutate(params);

  copyEnvironment = async (params: { description?: string; id: string; name: string }) =>
    lambdaClient.sandboxWorkspace.copyEnvironment.mutate(params);

  /** Refused while a conversation is still using it — the caller surfaces that. */
  removeEnvironment = async (params: { id: string; topicId?: string }) =>
    lambdaClient.sandboxWorkspace.removeEnvironment.mutate(params);

  /** Create a directory (parents included, idempotent). */
  createDirectory = async (params: { path: string; topicId?: string }) =>
    lambdaClient.sandboxWorkspace.createDirectory.mutate(params);

  /**
   * Whether this account has a persistent workspace at all. Pair it with the
   * `enablePersistentSandbox` lab flag the client already holds: flag off shows
   * nothing, flag on without an entitlement shows the upgrade prompt.
   */
  getEntitlement = async () => lambdaClient.sandboxWorkspace.getEntitlement.query();

  /** Quota and last measured usage of the workspace directory. */
  getWorkspace = async () => lambdaClient.sandboxWorkspace.getWorkspace.query();

  listFiles = async (params: { path?: string; recursive?: boolean; topicId?: string } = {}) =>
    lambdaClient.sandboxWorkspace.listFiles.query(params);

  readFile = async (params: { path: string; topicId?: string }) =>
    lambdaClient.sandboxWorkspace.readFile.query(params);

  removeFile = async (params: { path: string; recursive?: boolean; topicId?: string }) =>
    lambdaClient.sandboxWorkspace.removeFile.mutate(params);
}

export const sandboxWorkspaceService = new SandboxWorkspaceService();
