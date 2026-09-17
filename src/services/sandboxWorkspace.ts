import type { EnvironmentSource } from '@lobechat/types';

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
/**
 * The part of a specification this API accepts today, and deliberately narrower
 * than `EnvironmentConfiguration`.
 *
 * `sources` is git-only because every other transport authenticates with a key,
 * and a specification documented as carrying no credentials cannot present one.
 * `requirements` is absent because nothing schedules on it yet — the server
 * would drop it without a word, and a field the types refuse is better than one
 * that quietly evaporates.
 */
export interface SandboxEnvironmentSpecification {
  bootstrapCommand?: string;
  env?: Record<string, string>;
  excludePaths?: string[];
  internetAccess?: boolean;
  maintenanceCommand?: string;
  sources?: Extract<EnvironmentSource, { kind: 'git' }>[];
}

class SandboxWorkspaceService {
  /**
   * Environment specifications: what an environment should contain. Answered
   * from the database alone, so this returns immediately.
   */
  listEnvironments = async () => lambdaClient.sandboxWorkspace.listEnvironments.query();

  createEnvironment = async (params: { description?: string; name: string }) =>
    lambdaClient.sandboxWorkspace.createEnvironment.mutate(params);

  /**
   * Edits the specification. Nothing is rebuilt — every working copy of it just
   * becomes stale, and rebuilding one discards what that conversation installed
   * by hand, so it stays the person's call.
   */
  updateEnvironment = async (params: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
    id: string;
    name?: string;
  }) => lambdaClient.sandboxWorkspace.updateEnvironment.mutate(params);

  /** Refused while working copies still reference it — those go first. */
  removeEnvironment = async (params: { id: string }) =>
    lambdaClient.sandboxWorkspace.removeEnvironment.mutate(params);

  /**
   * Working copies, each joined with the state the execution plane holds. A
   * brand-new instance has no snapshot yet — that is normal, not an error, and
   * the UI shows it as unused rather than missing.
   *
   * Reaching the snapshot store needs a live sandbox session, so this can take
   * seconds on a cold start and callers should render a loading state.
   */
  listInstances = async (
    params: { environmentId?: string; topicId?: string; withSizes?: boolean } = {},
  ) => lambdaClient.sandboxWorkspace.listInstances.query(params);

  /** One working copy, from the database alone — no sandbox session, no wait. */
  getInstance = async (params: { id: string }) =>
    lambdaClient.sandboxWorkspace.getInstance.query(params);

  createInstance = async (params: {
    environmentId: string;
    name: string;
    workingDirectory: string;
  }) => lambdaClient.sandboxWorkspace.createInstance.mutate(params);

  /**
   * The working copy at this directory, created if there is not one yet. What
   * the composer calls when someone picks a directory — idempotent, so clicking
   * the same folder twice is not an error.
   */
  useInstanceAtDirectory = async (params: { workingDirectory: string }) =>
    lambdaClient.sandboxWorkspace.useInstanceAtDirectory.mutate(params);

  /** Only the label. The directory does not move — the built state sits in it. */
  renameInstance = async (params: { id: string; name: string }) =>
    lambdaClient.sandboxWorkspace.renameInstance.mutate(params);

  /** A second directory that starts with everything the first one had installed. */
  copyInstance = async (params: { id: string; name: string; workingDirectory: string }) =>
    lambdaClient.sandboxWorkspace.copyInstance.mutate(params);

  /** Refused while a conversation is still using it — the caller surfaces that. */
  removeInstance = async (params: { id: string; topicId?: string }) =>
    lambdaClient.sandboxWorkspace.removeInstance.mutate(params);

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
