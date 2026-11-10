import type {
  LocalAsrHardwareInfo,
  LocalAsrModelPackId,
  LocalAsrModelPackState,
  LocalAsrPreferences,
  LocalAsrPushAudioParams,
  LocalAsrSessionParams,
  LocalAsrStartSessionParams,
  LocalAsrStartSessionResult,
  LocalAsrStatus,
  LocalAsrStopSessionResult,
  LocalAsrTranscribeFileParams,
  LocalAsrTranscribeFileResult,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ElectronLocalAsrService {
  private get ipc() {
    return ensureElectronIpc();
  }

  getStatus(): Promise<LocalAsrStatus> {
    return this.ipc.localAsr.getStatus();
  }

  getHardwareInfo(): Promise<LocalAsrHardwareInfo> {
    return this.ipc.localAsr.getHardwareInfo();
  }

  setPreferences(patch: Partial<LocalAsrPreferences>): Promise<LocalAsrPreferences> {
    return this.ipc.localAsr.setPreferences(patch);
  }

  downloadModel(id: LocalAsrModelPackId): Promise<void> {
    return this.ipc.localAsr.downloadModel(id);
  }

  cancelModelDownload(id: LocalAsrModelPackId): Promise<void> {
    return this.ipc.localAsr.cancelModelDownload(id);
  }

  verifyModel(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    return this.ipc.localAsr.verifyModel(id);
  }

  deleteModel(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    return this.ipc.localAsr.deleteModel(id);
  }

  startSession(params: LocalAsrStartSessionParams): Promise<LocalAsrStartSessionResult> {
    return this.ipc.localAsr.startSession(params);
  }

  pushAudio(params: LocalAsrPushAudioParams): Promise<void> {
    return this.ipc.localAsr.pushAudio(params);
  }

  stopSession(params: LocalAsrSessionParams): Promise<LocalAsrStopSessionResult> {
    return this.ipc.localAsr.stopSession(params);
  }

  cancelSession(params: LocalAsrSessionParams): Promise<void> {
    return this.ipc.localAsr.cancelSession(params);
  }

  /** Absolute path of a WAV file chosen by the user, or undefined when cancelled */
  async pickAudioFile(title?: string): Promise<string | undefined> {
    const result = await this.ipc.localSystem.handleShowOpenDialog({
      filters: [{ extensions: ['wav'], name: 'WAV' }],
      title,
    });
    return result.canceled ? undefined : result.filePaths[0];
  }

  transcribeFile(params: LocalAsrTranscribeFileParams): Promise<LocalAsrTranscribeFileResult> {
    return this.ipc.localAsr.transcribeFile(params);
  }
}

export const electronLocalAsrService = new ElectronLocalAsrService();
