import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCliDirName } from '../constants/identity';
import { OFFICIAL_AGENT_GATEWAY_URL, OFFICIAL_SERVER_URL } from '../constants/urls';
import { log } from '../utils/logger';

export interface StoredSettings {
  agentGatewayUrl?: string;
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

export function saveSettings(settings: StoredSettings): void {
  const agentGatewayUrl = normalizeUrl(settings.agentGatewayUrl);
  const gatewayUrl = normalizeUrl(settings.gatewayUrl);
  const serverUrl = normalizeUrl(settings.serverUrl);
  const normalized: StoredSettings = {
    agentGatewayUrl: agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL ? undefined : agentGatewayUrl,
    gatewayUrl,
    serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
  };

  if (!normalized.serverUrl && !normalized.gatewayUrl && !normalized.agentGatewayUrl) {
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
    const parsed = JSON.parse(data) as StoredSettings;
    const agentGatewayUrl = normalizeUrl(parsed.agentGatewayUrl);
    const gatewayUrl = normalizeUrl(parsed.gatewayUrl);
    const serverUrl = normalizeUrl(parsed.serverUrl);
    const normalized: StoredSettings = {
      agentGatewayUrl: agentGatewayUrl === OFFICIAL_AGENT_GATEWAY_URL ? undefined : agentGatewayUrl,
      gatewayUrl,
      serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
    };

    if (!normalized.serverUrl && !normalized.gatewayUrl && !normalized.agentGatewayUrl) return null;

    return normalized;
  } catch {
    log.warn(
      `Could not parse ${SETTINGS_FILE}. Please delete this file and run 'lh login' again if needed.`,
    );
    return null;
  }
}
