import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OFFICIAL_AGENT_GATEWAY_URL, OFFICIAL_SERVER_URL } from '../constants/urls';
import { log } from '../utils/logger';

export interface StoredSettings {
  agentGatewayUrl?: string;
  gatewayUrl?: string;
  serverUrl?: string;
}

const LOBEHUB_DIR_NAME = process.env.LOBEHUB_CLI_HOME || '.lobehub';
const SETTINGS_DIR = path.join(os.homedir(), LOBEHUB_DIR_NAME);
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

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
    } catch {}
    return;
  }

  fs.mkdirSync(SETTINGS_DIR, { mode: 0o700, recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2), { mode: 0o600 });
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
