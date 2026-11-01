/**
 * Workspace-level device RPCs: project scan, skill cache, workspace
 * enrollment, and path / port probes.
 */
import type {
  DeviceListeningPortsResult,
  ProjectSkillMeta,
  WorkspaceInitResult,
} from '@lobechat/types';
import debug from 'debug';

import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Scan a bound project directory on the device in a single round-trip:
 * project skills (`.agents/skills` + `.claude/skills`) plus the root
 * `AGENTS.md` / `CLAUDE.md`. Routed through the generic device RPC relay
 * (`invokeRpc`) — a server-internal channel the agent never sees, distinct
 * from the LLM-facing tool-call path.
 *
 * Returns `undefined` when the gateway is unconfigured, the device is offline,
 * or the call fails — callers fall back to the cached scan.
 */
export async function initWorkspace(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<WorkspaceInitResult | undefined> {
  const { userId, deviceId, scope, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    // The device returns rich `ProjectSkillItem`s; narrow to metadata only so
    // the cached `workingDirs` payload stays small (SKILL.md bodies are still
    // read lazily at activation time). Keep scope so project/device skills can
    // be displayed and activated with the correct origin.
    const result = await client.invokeRpc<{
      instructions?: WorkspaceInitResult['instructions'];
      skills?: (ProjectSkillMeta & Record<string, unknown>)[];
    }>({ deviceId, timeout, userId, workspaceId }, { method: 'initWorkspace', params: { scope } });

    if (!result.success || !result.data) {
      log('initWorkspace: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    const { instructions, skills } = result.data;
    return {
      instructions: instructions ?? [],
      skills: (skills ?? []).map(({ description, name, path, scope }) => ({
        description,
        name,
        path,
        scope,
      })),
    };
  } catch (error) {
    log('initWorkspace: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Prepare a skill archive on the device: download the presigned zip and
 * extract it into the device-local cache (idempotent by `zipHash`). Runs on
 * the generic device RPC relay like `initWorkspace`, but unlike the
 * read-oriented helpers, failures are RETURNED with their reason instead of
 * collapsing to `undefined` — the skills exec path must tell the model why
 * the device can't run the skill (offline, outdated client, download
 * failure) rather than silently degrading to the sandbox.
 */
export async function prepareSkillDirectory(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    forceRefresh?: boolean;
    timeout?: number;
    url: string;
    userId: string;
    workspaceId?: string;
    zipHash: string;
  },
): Promise<{ error?: string; extractedDir?: string; success: boolean }> {
  const { deviceId, forceRefresh, timeout = 60_000, url, userId, workspaceId, zipHash } = params;
  const client = getClient();
  if (!client) return { error: 'Device Gateway is not configured', success: false };

  try {
    const result = await client.invokeRpc<{
      error?: string;
      extractedDir: string;
      success: boolean;
    }>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'prepareSkillDirectory', params: { forceRefresh, url, zipHash } },
    );

    if (!result.success || !result.data) {
      return { error: result.error || 'prepareSkillDirectory failed', success: false };
    }

    return result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('prepareSkillDirectory: error for deviceId=%s — %s', deviceId, message);
    return { error: message, success: false };
  }
}

/**
 * Instruct an ONLINE personal device to enroll itself into a workspace: the
 * device derives its workspace-scoped deviceId and opens a second gateway
 * connection under the `workspace:<id>` principal using the short-lived
 * `token` (a signed workspace-device connect token), then returns the derived
 * identity so the caller can register the workspace row server-side. Rides
 * the generic device RPC relay over the PERSONAL pool (no `workspaceId` in
 * the address — the workspace connection doesn't exist yet). Failures are
 * RETURNED with their reason — the share flow must tell the user why the
 * device couldn't enroll (offline, outdated client) instead of silently
 * doing nothing.
 */
export async function enrollWorkspace(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    /**
     * Dry-run: the device only derives and returns its workspace identity,
     * without opening a share connection or persisting enrollment state.
     * Older clients ignore the flag and enroll on the probe (pre-flag
     * behaviour), so callers must treat the probe as possibly-enrolling.
     */
    identityOnly?: boolean;
    timeout?: number;
    token: string;
    userId: string;
    workspaceId: string;
  },
): Promise<{
  error?: string;
  identity?: { deviceId: string; identitySource: 'fallback' | 'machine-id' };
  success: boolean;
}> {
  const { deviceId, identityOnly, timeout = 30_000, token, userId, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device Gateway is not configured', success: false };

  try {
    const result = await client.invokeRpc<{
      deviceId: string;
      identitySource: 'fallback' | 'machine-id';
    }>(
      { deviceId, timeout, userId },
      {
        method: 'enrollWorkspace',
        params: { ...(identityOnly ? { identityOnly } : {}), token, workspaceId },
      },
    );

    if (!result.success || !result.data) {
      return { error: result.error || 'enrollWorkspace failed', success: false };
    }

    return { identity: result.data, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('enrollWorkspace: error for deviceId=%s — %s', deviceId, message);
    return { error: message, success: false };
  }
}

/**
 * Instruct an ONLINE workspace device to drop its enrollment: close the
 * workspace-principal connection and clear any persisted auto-reconnect state
 * on the machine. Addressed over the WORKSPACE pool (the connection being
 * killed), so it works regardless of who enrolled the device or whether a
 * personal connection exists. Best-effort — callers delete the DB row either
 * way, so an offline device simply loses its row and stops resolving.
 */
export async function unenrollWorkspace(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    timeout?: number;
    userId: string;
    workspaceId: string;
  },
): Promise<{ error?: string; success: boolean }> {
  const { deviceId, timeout = 10_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device Gateway is not configured', success: false };

  try {
    const result = await client.invokeRpc<{ success: boolean }>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'unenrollWorkspace', params: { workspaceId } },
    );
    if (!result.success)
      return { error: result.error || 'unenrollWorkspace failed', success: false };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('unenrollWorkspace: error for deviceId=%s — %s', deviceId, message);
    return { error: message, success: false };
  }
}

/**
 * Check whether a path exists on the device and is a directory, via the same
 * generic `invokeRpc` channel as `gitInfo`. Lets a web / remote client
 * validate a manually-entered working directory before binding it. Returns
 * `undefined` when the gateway is unconfigured or the device is unreachable
 * (the caller treats "can't verify" as non-blocking).
 */
export async function statPath(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<
  | {
      canonicalPath?: string;
      exists: boolean;
      isDirectory: boolean;
      repositoryUrl?: string;
      repoType?: 'git' | 'github';
    }
  | undefined
> {
  const { userId, deviceId, path, timeout = 8000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<{
      canonicalPath?: string;
      exists: boolean;
      isDirectory: boolean;
      repoType?: 'git' | 'github';
    }>({ deviceId, timeout, userId, workspaceId }, { method: 'statPath', params: { path } });

    if (!result.success || !result.data) {
      log('statPath: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('statPath: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * TCP ports the device is listening on that a tunnel can reach, with the
 * project's own ports marked. Resolves undefined when the device is
 * offline or predates the RPC — the UI then says it can't read the ports.
 */
export async function listListeningPorts(
  getClient: DeviceClientGetter,
  params: {
    cwd?: string;
    deviceId: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceListeningPortsResult | undefined> {
  const { cwd, deviceId, timeout = 10_000, userId, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceListeningPortsResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listListeningPorts', params: { cwd } },
    );
    if (!result.success || !result.data) {
      log('listListeningPorts: failed for deviceId=%s', deviceId);
      return undefined;
    }
    return result.data;
  } catch (error) {
    log(
      'listListeningPorts: error for deviceId=%s (%s)',
      deviceId,
      error instanceof Error ? error.name : typeof error,
    );
    return undefined;
  }
}
