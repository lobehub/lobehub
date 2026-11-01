import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { markDefaultInstances } from '@lobechat/utils/environmentInstance';

import { lambdaClient } from '@/libs/trpc/client';

export type { SandboxDrive };

/**
 * Renderer-side data layer for the user's network drives and the environment
 * directories initialized on them.
 *
 * `drive` names which of a workspace's drives a call means — `public`, shared
 * by every member, or `personal`, the caller's own — and defaults to the
 * public one there; a personal account has one drive and ignores it. A call
 * about an environment directory goes to the drive that directory is on.
 *
 * Every path is relative to the drive's root (`reports/q3.md`); the absolute
 * mount path stays server-side, so there is nothing here for a caller to point
 * outside the drive with.
 *
 * `topicId` is an optimization, not a scope: the drive belongs to the user (or
 * the team), not the topic, but some calls are only reachable from inside a
 * sandbox session, so naming the topic the user is already talking to reuses
 * that warm session instead of cold-starting a second sandbox.
 *
 * The definitions environments are built from need no drive and live in
 * `environmentService`.
 */
class SandboxStorageService {
  /**
   * Replaces a file's whole contents, creating it and its parents if needed.
   * Text only — the execution plane carries the body as a JSON string.
   */
  writeFile = async (params: {
    content: string;
    drive?: SandboxDrive;
    instanceId?: string;
    path: string;
    topicId?: string;
  }) => lambdaClient.sandboxStorage.writeFile.mutate(params);

  /**
   * Instances, each joined with the state the execution plane holds. A
   * brand-new instance has no snapshot yet — that is normal, not an error, and
   * the UI shows it as unused rather than missing.
   *
   * Reaching the snapshot store needs a live sandbox session, so this can take
   * seconds on a cold start and callers should render a loading state.
   *
   * Each instance carries `isDefault`, from the same rule the server's delete
   * guard applies, so no caller has to re-derive which copy is the default.
   */
  listInstances = async (
    params: {
      drive?: SandboxDrive;
      environmentId?: string;
      topicId?: string;
      withSizes?: boolean;
    } = {},
  ) => {
    const result = await lambdaClient.sandboxStorage.listInstances.query(params);

    return { ...result, instances: markDefaultInstances(result.instances) };
  };

  /**
   * The run history of every instance of one environment, newest first: each
   * sandbox session that ran it and each build of it, with how it ended and
   * whether its snapshot was saved. Read from the control plane's records —
   * no sandbox session, no wait.
   */
  listInstanceSessions = async (params: { environmentId: string; limit?: number }) =>
    lambdaClient.sandboxStorage.listInstanceSessions.query(params);

  /** One instance, from the database alone — no sandbox session, no wait. */
  getInstance = async (params: { id: string }) =>
    lambdaClient.sandboxStorage.getInstance.query(params);

  createInstance = async (params: {
    environmentId: string;
    name: string;
    workingDirectory: string;
  }) => lambdaClient.sandboxStorage.createInstance.mutate(params);

  /**
   * Materializes an instance: clones the environment's sources and runs its
   * bootstrap. Returns as soon as the build has started.
   *
   * Separate from {@link createInstance} because starting one attaches a
   * sandbox session, which is a cold start — the dialog closes on the insert
   * and this follows it.
   */
  startInstanceBuild = async (params: { id: string; topicId?: string }) =>
    lambdaClient.sandboxStorage.startInstanceBuild.mutate(params);

  /** Follows a build, and settles the instance once it ends. */
  instanceBuildStatus = async (params: { id: string; logOffset?: number; topicId?: string }) =>
    lambdaClient.sandboxStorage.instanceBuildStatus.query(params);

  /**
   * A new instance of an environment, with its directory derived server-side.
   *
   * What the composer calls: someone picking an environment has not chosen a
   * folder, and the folder holds outputs that do not exist yet, so asking would
   * make them invent an answer before the work.
   */
  createInstanceForEnvironment = async (params: { environmentId: string }) =>
    lambdaClient.sandboxStorage.createInstanceForEnvironment.mutate(params);

  /** Only the label. The directory does not move — the built state sits in it. */
  renameInstance = async (params: { id: string; name: string }) =>
    lambdaClient.sandboxStorage.renameInstance.mutate(params);

  /** A second directory that starts with everything the first one had installed. */
  /**
   * Where this topic's sandbox commands run, for the prompt that describes it.
   * The placement only — the entitlement it follows never leaves the server.
   */
  resolveSessionPlacement = async (params: { topicId?: string }) =>
    lambdaClient.sandboxStorage.resolveSessionPlacement.query(params);

  copyInstance = async (params: { id: string; name: string; workingDirectory: string }) =>
    lambdaClient.sandboxStorage.copyInstance.mutate(params);

  /** Refused while a conversation is still using it — the caller surfaces that. */
  removeInstance = async (params: { id: string; topicId?: string }) =>
    lambdaClient.sandboxStorage.removeInstance.mutate(params);

  /**
   * Ends the run holding an instance, so it is free now rather than after the
   * idle sweep. The execution plane saves that run's snapshot first, so this
   * can take seconds — and refuses, retryably, while the snapshot is still
   * packing. `stopped: false` means nothing was holding it.
   */
  stopInstance = async (params: { id: string }) =>
    lambdaClient.sandboxStorage.stopInstance.mutate(params);

  /** Rename or move a file or folder; never overwrites an existing one. */
  renameFile = async (params: {
    drive?: SandboxDrive;
    newPath: string;
    path: string;
    topicId?: string;
  }) => lambdaClient.sandboxStorage.renameFile.mutate(params);

  /** Create a directory (parents included, idempotent). */
  createDirectory = async (params: {
    drive?: SandboxDrive;
    instanceId?: string;
    path: string;
    topicId?: string;
  }) => lambdaClient.sandboxStorage.createDirectory.mutate(params);

  /**
   * Whether this account has a drive at all. Without one, the directory
   * picker's sandbox side shows the way to a plan instead of folders.
   */
  getEntitlement = async () => lambdaClient.sandboxStorage.getEntitlement.query();

  /** Quota and last measured usage of one drive. */
  getStorage = async (params: { drive?: SandboxDrive; topicId?: string } = {}) =>
    lambdaClient.sandboxStorage.getStorage.query(params);

  /**
   * Usage of each of the caller's drives against the plan's one quota pool —
   * and, for a workspace owner or admin, of every member's personal drive.
   * Amounts only; nobody can browse another member's drive.
   */
  getDriveUsage = async () => lambdaClient.sandboxStorage.getDriveUsage.query();

  /**
   * Walk the workspace and answer with the fresh figure. For a refresh the
   * user asked for — {@link getStorage} reads what was last measured, which
   * is what a page load should show.
   */
  refreshStorageUsage = async (params: { drive?: SandboxDrive } = {}) =>
    lambdaClient.sandboxStorage.refreshStorageUsage.mutate(params);

  listFiles = async (
    params: {
      drive?: SandboxDrive;
      instanceId?: string;
      path?: string;
      recursive?: boolean;
      topicId?: string;
    } = {},
  ) => lambdaClient.sandboxStorage.listFiles.query(params);

  readFile = async (params: {
    drive?: SandboxDrive;
    instanceId?: string;
    path: string;
    topicId?: string;
  }) => lambdaClient.sandboxStorage.readFile.query(params);

  removeFile = async (params: {
    drive?: SandboxDrive;
    instanceId?: string;
    path: string;
    recursive?: boolean;
    topicId?: string;
  }) => lambdaClient.sandboxStorage.removeFile.mutate(params);
}

export const sandboxStorageService = new SandboxStorageService();
