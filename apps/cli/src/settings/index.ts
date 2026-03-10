import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OFFICIAL_SERVER_URL } from '../constants/urls';
import { log } from '../utils/logger';

export interface StoredSettings {
  gatewayUrl?: string;
  serverUrl?: string;
}

const SETTINGS_DIR = path.join(os.homedir(), '.lobehub');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

function normalizeUrl(url: string | undefined): string | undefined {
  return url ? url.replace(/\/$/, '') : undefined;
}

export function saveSettings(settings: StoredSettings): void {
  const serverUrl = normalizeUrl(settings.serverUrl);
  const gatewayUrl = normalizeUrl(settings.gatewayUrl);
  const normalized: StoredSettings = {
    gatewayUrl,
    serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
  };

  if (!normalized.serverUrl && !normalized.gatewayUrl) {
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
    const gatewayUrl = normalizeUrl(parsed.gatewayUrl);
    const serverUrl = normalizeUrl(parsed.serverUrl);
    const normalized: StoredSettings = {
      gatewayUrl,
      serverUrl: serverUrl === OFFICIAL_SERVER_URL ? undefined : serverUrl,
    };

    if (!normalized.serverUrl && !normalized.gatewayUrl) return null;

    return normalized;
  } catch {
    log.warn(
      `Could not parse ${SETTINGS_FILE}. Please delete this file and run 'lh login' again if needed.`,
    );
    return null;
  }
}
