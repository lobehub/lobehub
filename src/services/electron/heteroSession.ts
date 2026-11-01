import {
  type HeteroSessionDirPref,
  type HeteroSessionImportPayload,
  type HeteroSessionImportSource,
  type HeteroSessionScanResult,
} from '@lobechat/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Renderer-side wrapper for the `heteroSession.*` IPC group exposed by
 * HeteroSessionController: discovery of local CLI agent transcripts
 * (Claude Code / Codex) and per-directory import preferences.
 */
class ElectronHeteroSessionService {
  private get ipc() {
    return ensureElectronIpc();
  }

  async listLocalSessions(): Promise<HeteroSessionScanResult> {
    return this.ipc.heteroSession.listLocalSessions();
  }

  async readLocalSession(params: {
    filePath: string;
    source: HeteroSessionImportSource;
  }): Promise<HeteroSessionImportPayload | null> {
    return this.ipc.heteroSession.readLocalSession(params);
  }

  async getDirPrefs(): Promise<Record<string, HeteroSessionDirPref>> {
    return this.ipc.heteroSession.getDirPrefs();
  }

  async setDirPref(params: { key: string; pref: HeteroSessionDirPref | null }): Promise<void> {
    return this.ipc.heteroSession.setDirPref(params);
  }
}

export const electronHeteroSessionService = new ElectronHeteroSessionService();
