import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deviceMetricsBacklogFileName } from '@lobechat/device-control/metrics';
import { deviceGatewayServerKey, normalizeDeviceGatewayUrl } from '@lobechat/device-gateway-client';

import { resolveCliDirName } from '../constants/identity';
import { OFFICIAL_AGENT_GATEWAY_URL, OFFICIAL_SERVER_URL } from '../constants/urls';
import { log } from '../utils/logger';

export interface StoredSettings {
  agentGatewayUrl?: string;
  /**
   * Device gateway address saved per server (keyed by `deviceGatewayServerKey`)
   * by `--gateway`. Used ahead of that server's own advertisement, and never
   * for another server.
   */
  deviceGatewayUrls?: Record<string, string>;
  /**
   * Pre-discovery global device gateway. Read only as the saved address of the
   * login it was saved with (`serverUrl`, or official cloud when that is unset).
   */
  gatewayUrl?: string;
  serverUrl?: string;
}

const LOBEHUB_DIR_NAME = resolveCliDirName();
const SETTINGS_DIR = path.join(os.homedir(), LOBEHUB_DIR_NAME);
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
// Kept in its own file rather than settings.json, which is unlinked whenever
// all server/gateway URLs are default — the connectionId must persist regardless.
const CONNECTION_ID_FILE = path.join(SETTINGS_DIR, 'connection-id');
// Workspaces this machine's PERSONAL connection has been shared into via the
// `enrollWorkspace` RPC. Persisted so a daemon/process restart can re-open the
// workspace share connections without the user re-sharing from the web UI.
const WORKSPACE_ENROLLMENTS_FILE = path.join(SETTINGS_DIR, 'workspace-enrollments.json');
// The workspace scope every command runs under, set by `lh workspace use`. Kept
// out of settings.json for the same reason as connection-id: that file is
// unlinked whenever all URLs are default, which would silently drop the scope.
const ACTIVE_WORKSPACE_FILE = path.join(SETTINGS_DIR, 'active-workspace');
const WORKSPACE_ID_PATTERN = /^[\w-]{1,64}$/;

export function normalizeUrl(url: string | undefined): string | undefined {
  return url ? url.replace(/\/$/, '') : undefined;
}

export function resolveServerUrl(): string {
  const envServerUrl = normalizeUrl(process.env.LOBEHUB_SERVER);
  const settingsServerUrl = normalizeUrl(loadSettings()?.serverUrl);

  return envServerUrl || settingsServerUrl || OFFICIAL_SERVER_URL;
}

export function resolveAgentGatewayUrl(): string | undefined {
  const envUrl = normalizeUrl(process.env.AGENT_GATEWAY_URL);
  const settingsUrl = normalizeUrl(loadSettings()?.agentGatewayUrl);

  return envUrl || settingsUrl || OFFICIAL_AGENT_GATEWAY_URL;
}

function normalizeDeviceGatewayUrls(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const entries = Object.entries(value).flatMap(([server, url]) => {
    const key = deviceGatewayServerKey(server);
    const normalized = normalizeDeviceGatewayUrl(url);
    return key && normalized ? [[key, normalized] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeSettings(settings: StoredSettings): StoredSettings {
  const agentGatewayUrl = normalizeUrl(settings.agentGatewayUrl);
  const serverUrl = normalizeUrl(settings.serverUrl);

  return {
    agentGatewayUrl: agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL ? undefined : agentGatewayUrl,
    deviceGatewayUrls: normalizeDeviceGatewayUrls(settings.deviceGatewayUrls),
    gatewayUrl: normalizeUrl(settings.gatewayUrl),
    serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
  };
}

const isDefaultSettings = (settings: StoredSettings) =>
  !settings.serverUrl &&
  !settings.gatewayUrl &&
  !settings.agentGatewayUrl &&
  !settings.deviceGatewayUrls;

export function saveSettings(settings: StoredSettings): void {
  const normalized = normalizeSettings(settings);

  if (isDefaultSettings(normalized)) {
    try {
      fs.unlinkSync(SETTINGS_FILE);
    } catch (error) {
      log.debug('Skipping settings file removal for default settings', error);
    }
    return;
  }

  fs.mkdirSync(SETTINGS_DIR, { mode: 0o700, recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

/**
 * Machine health samples not yet uploaded, one file per device identity so a
 * personal and a workspace connection on the same machine keep separate
 * backlogs.
 */
export function resolveDeviceMetricsBacklogPath(deviceId: string): string {
  return path.join(SETTINGS_DIR, 'device-metrics', deviceMetricsBacklogFileName(deviceId));
}

/**
 * Stable per-install connection routing key for `lh connect`. Decoupled from
 * the (machine-derived, shared-across-clients) deviceId so the gateway only
 * replaces this install's own stale socket — a co-running desktop app on the
 * same machine keeps its connection. Persisted under the CLI home dir, so a
 * separate `LOBEHUB_CLI_HOME` (e.g. a dev build) naturally gets its own id.
 */
export function loadOrCreateConnectionId(): string {
  try {
    const existing = fs.readFileSync(CONNECTION_ID_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // not yet created
  }

  const id = randomUUID();
  try {
    fs.mkdirSync(SETTINGS_DIR, { mode: 0o700, recursive: true });
    fs.writeFileSync(CONNECTION_ID_FILE, id, { mode: 0o600 });
  } catch {
    // best-effort: an unwritable home dir just means a fresh id per run
  }
  return id;
}

/**
 * Load the workspaceIds this machine is enrolled into as a shared device.
 * Missing / corrupt file degrades to "no enrollments" — the server remains the
 * source of truth, this list is only the reconnect hint.
 */
export function loadWorkspaceEnrollments(): string[] {
  try {
    const data = fs.readFileSync(WORKSPACE_ENROLLMENTS_FILE, 'utf8');
    const parsed: unknown = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // not yet created or unreadable — treat as no enrollments
  }
  return [];
}

function saveWorkspaceEnrollments(workspaceIds: string[]): void {
  try {
    if (workspaceIds.length === 0) {
      fs.unlinkSync(WORKSPACE_ENROLLMENTS_FILE);
      return;
    }
    fs.mkdirSync(SETTINGS_DIR, { mode: 0o700, recursive: true });
    fs.writeFileSync(WORKSPACE_ENROLLMENTS_FILE, JSON.stringify(workspaceIds, null, 2), {
      mode: 0o600,
    });
  } catch {
    // best-effort: a failed write only loses auto-reconnect after a restart
  }
}

export function addWorkspaceEnrollment(workspaceId: string): void {
  const current = loadWorkspaceEnrollments();
  if (current.includes(workspaceId)) return;
  saveWorkspaceEnrollments([...current, workspaceId]);
}

export function removeWorkspaceEnrollment(workspaceId: string): void {
  const current = loadWorkspaceEnrollments();
  if (!current.includes(workspaceId)) return;
  saveWorkspaceEnrollments(current.filter((id) => id !== workspaceId));
}

/**
 * The workspace scope persisted by `lh workspace use`, together with the server
 * and account it was chosen under.
 *
 * The binding is the point: a bare workspace id survives `logout`, a login as a
 * different account, and a `--server` switch, and would then attach an
 * `X-Workspace-Id` the new identity has no membership in — which cloud's compat
 * middleware silently downgrades to personal scope, so writes land on personal
 * data while the CLI still claims to be in a workspace.
 */
export interface ActiveWorkspaceRecord {
  /** Opaque fingerprint of the credentials the scope was chosen under. */
  identity: string;
  serverUrl: string;
  workspaceId: string;
}

export function loadActiveWorkspace(): ActiveWorkspaceRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ACTIVE_WORKSPACE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;

    const { identity, serverUrl, workspaceId } = parsed as Record<string, unknown>;
    // A garbage value would be sent as `X-Workspace-Id` on every request and
    // fail each one with an opaque server error, so anything that isn't
    // id-shaped is treated as a corrupt file and ignored.
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId))
      return undefined;
    if (typeof identity !== 'string' || !identity) return undefined;
    if (typeof serverUrl !== 'string' || !serverUrl) return undefined;

    return { identity, serverUrl, workspaceId };
  } catch {
    // not yet created, unreadable, or not JSON — personal scope
    return undefined;
  }
}

/** Persist the active workspace scope; pass `null` to fall back to personal. */
export function saveActiveWorkspace(record: ActiveWorkspaceRecord | null): void {
  if (!record) {
    try {
      fs.unlinkSync(ACTIVE_WORKSPACE_FILE);
    } catch (error) {
      log.debug('No active workspace file to remove', error);
    }
    return;
  }

  fs.mkdirSync(SETTINGS_DIR, { mode: 0o700, recursive: true });
  fs.writeFileSync(ACTIVE_WORKSPACE_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
}

export function loadSettings(): StoredSettings | null {
  if (!fs.existsSync(SETTINGS_FILE)) return null;

  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const normalized = normalizeSettings(JSON.parse(data) as StoredSettings);

    return isDefaultSettings(normalized) ? null : normalized;
  } catch {
    log.warn(
      `Could not parse ${SETTINGS_FILE}. Please delete this file and run 'lh login' again if needed.`,
    );
    return null;
  }
}

/**
 * The server a pre-discovery `gatewayUrl` belongs to: the saved login it was
 * used with (`serverUrl` is only stored for a non-official server).
 */
const legacyGatewayOwner = (settings: StoredSettings | null) =>
  settings?.gatewayUrl
    ? deviceGatewayServerKey(settings.serverUrl || OFFICIAL_SERVER_URL)
    : undefined;

/**
 * Device gateway address saved for `serverUrl` — the server the current
 * credential belongs to, which may differ from `settings.serverUrl` when
 * `LOBEHUB_SERVER` points elsewhere. Never another server's address.
 */
export function loadDeviceGatewayUrl(serverUrl: string): string | undefined {
  const key = deviceGatewayServerKey(serverUrl);
  const settings = loadSettings();
  if (!key || !settings) return undefined;

  return (
    settings.deviceGatewayUrls?.[key] ??
    (legacyGatewayOwner(settings) === key ? settings.gatewayUrl : undefined)
  );
}

/** Remember `gatewayUrl` as the device gateway of `serverUrl`. */
export function saveDeviceGatewayUrl(serverUrl: string, gatewayUrl: string): void {
  const key = deviceGatewayServerKey(serverUrl);
  if (!key) return;

  const settings = loadSettings() ?? {};
  saveSettings({
    ...settings,
    deviceGatewayUrls: { ...settings.deviceGatewayUrls, [key]: gatewayUrl },
    // Superseded by the entry just written for the same server.
    gatewayUrl: legacyGatewayOwner(settings) === key ? undefined : settings.gatewayUrl,
  });
}

/**
 * Settings after logging in to `serverUrl`, from the `existing` ones. Saved
 * device gateway addresses are keyed by server, so they all carry over; a
 * pre-discovery `gatewayUrl` stays with the server it was saved for instead of
 * following the login to another one.
 */
export function settingsForLogin(
  existing: StoredSettings | null,
  serverUrl: string,
): StoredSettings {
  const sameServer = (existing?.serverUrl || OFFICIAL_SERVER_URL) === serverUrl;
  const deviceGatewayUrls = { ...existing?.deviceGatewayUrls };

  const gatewayUrl = sameServer ? existing?.gatewayUrl : undefined;
  const owner = legacyGatewayOwner(existing);
  if (!sameServer && owner && !deviceGatewayUrls[owner]) {
    deviceGatewayUrls[owner] = existing!.gatewayUrl!;
  }

  return {
    ...(Object.keys(deviceGatewayUrls).length > 0 && { deviceGatewayUrls }),
    ...(gatewayUrl && { gatewayUrl }),
    serverUrl,
  };
}
