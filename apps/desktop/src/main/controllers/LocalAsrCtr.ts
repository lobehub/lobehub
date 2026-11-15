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
import { app as electronApp } from 'electron';

import { mainDir, userDataDir } from '@/const/dir';
import { LocalAsrService } from '@/modules/localAsr/LocalAsrService';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:LocalAsrCtr');

/**
 * On-device meeting transcription (sherpa-onnx). Model management, engine
 * sessions and the per-device "local / cloud" preference.
 */
export default class LocalAsrCtr extends ControllerModule {
  static override readonly groupName = 'localAsr';

  private _service?: LocalAsrService;

  private get service() {
    if (!this._service) {
      this._service = new LocalAsrService({
        hardwareOverride: electronApp.isPackaged
          ? undefined
          : process.env.LOBE_LOCAL_ASR_HARDWARE_OVERRIDE,
        getPreferences: () => this.app.storeManager.get('localAsr'),
        mainDir,
        onEvent: (event) => this.app.browserManager.broadcastToAllWindows('localAsrEvent', event),
        onJobProgress: (payload) =>
          this.app.browserManager.broadcastToAllWindows('localAsrJobProgress', payload),
        onModelProgress: (payload) =>
          this.app.browserManager.broadcastToAllWindows('localAsrModelProgress', payload),
        setPreferences: (preferences) => this.app.storeManager.set('localAsr', preferences),
        userDataDir,
      });
    }
    return this._service;
  }

  @IpcMethod()
  async getStatus(): Promise<LocalAsrStatus> {
    return this.service.getStatus();
  }

  @IpcMethod()
  async getHardwareInfo(): Promise<LocalAsrHardwareInfo> {
    return this.service.getHardware();
  }

  @IpcMethod()
  async setPreferences(patch: Partial<LocalAsrPreferences>): Promise<LocalAsrPreferences> {
    return this.service.setPreferences(patch);
  }

  /** Starts the download in the background; progress arrives as `localAsrModelProgress`. */
  @IpcMethod()
  async downloadModel(id: LocalAsrModelPackId): Promise<void> {
    void this.service.downloadPack(id).catch((error) => {
      logger.error(`download of ${id} failed:`, error);
    });
  }

  @IpcMethod()
  async cancelModelDownload(id: LocalAsrModelPackId): Promise<void> {
    this.service.models.cancel(id);
  }

  @IpcMethod()
  async verifyModel(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    return this.service.models.verify(id);
  }

  @IpcMethod()
  async deleteModel(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    return this.service.models.delete(id);
  }

  @IpcMethod()
  async startSession(params: LocalAsrStartSessionParams): Promise<LocalAsrStartSessionResult> {
    return this.service.startSession(params);
  }

  @IpcMethod()
  async pushAudio({ frame, sessionId }: LocalAsrPushAudioParams): Promise<void> {
    this.service.pushAudio(sessionId, frame);
  }

  @IpcMethod()
  async stopSession({ sessionId }: LocalAsrSessionParams): Promise<LocalAsrStopSessionResult> {
    return this.service.stopSession(sessionId);
  }

  @IpcMethod()
  async cancelSession({ sessionId }: LocalAsrSessionParams): Promise<void> {
    await this.service.cancelSession(sessionId);
  }

  @IpcMethod()
  async transcribeFile(
    params: LocalAsrTranscribeFileParams,
  ): Promise<LocalAsrTranscribeFileResult> {
    return this.service.transcribeFile(params);
  }

  afterAppReady() {
    electronApp.on('before-quit', () => {
      this._service?.dispose();
    });
  }
}
