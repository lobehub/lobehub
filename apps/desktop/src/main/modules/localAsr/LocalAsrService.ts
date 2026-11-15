import { randomUUID } from 'node:crypto';
import { mkdir, statfs } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type {
  LocalAsrHardwareInfo,
  LocalAsrJobProgressPayload,
  LocalAsrModelPackId,
  LocalAsrModelProgressPayload,
  LocalAsrPreferences,
  LocalAsrRealtimeEvent,
  LocalAsrStartSessionParams,
  LocalAsrStartSessionResult,
  LocalAsrStatus,
  LocalAsrStopSessionResult,
  LocalAsrTranscribeFileParams,
  LocalAsrTranscribeFileResult,
} from '@lobechat/electron-client-ipc';

import { createLogger } from '@/utils/logger';

import { getPackSize, LOCAL_ASR_MODEL_PACKS } from './catalog';
import type { AsrModelPaths, DiarizationModelPaths } from './engine';
import { LocalAsrEngineHost } from './EngineHost';
import { assessHardware } from './hardware';
import { LocalAsrModelManager } from './ModelManager';

const RUNTIME_PACKAGE = 'sherpa-onnx-node';

const logger = createLogger('modules:localAsr');

export class LocalAsrError extends Error {
  constructor(readonly code: 'MODEL_NOT_READY' | 'RUNTIME_UNAVAILABLE') {
    super(code);
    this.name = 'LocalAsrError';
  }
}

interface LocalAsrServiceOptions {
  getPreferences: () => LocalAsrPreferences;
  /** Dev-only JSON patch over the probed hardware, to preview other machines' hints */
  hardwareOverride?: string;
  /** Directory of the bundled main process (holds `localAsrWorker.js`) */
  mainDir: string;
  onEvent: (event: LocalAsrRealtimeEvent) => void;
  onJobProgress: (payload: LocalAsrJobProgressPayload) => void;
  onModelProgress: (payload: LocalAsrModelProgressPayload) => void;
  setPreferences: (preferences: LocalAsrPreferences) => void;
  userDataDir: string;
}

const platformPackage = () => {
  const platform = os.platform() === 'win32' ? 'win' : os.platform();
  return `sherpa-onnx-${platform}-${os.arch()}`;
};

/**
 * Desktop-side owner of local transcription: model files, hardware assessment,
 * per-device preferences and the engine process. Audio only travels
 * renderer → main → engine over IPC and never leaves the machine.
 */
export class LocalAsrService {
  readonly models: LocalAsrModelManager;
  private readonly engine: LocalAsrEngineHost;
  private readonly opts: LocalAsrServiceOptions;
  private readonly recordingsDir: string;
  private readonly require = createRequire(__filename);
  private runtimePath?: string | null;

  constructor(opts: LocalAsrServiceOptions) {
    this.opts = opts;
    this.models = new LocalAsrModelManager({
      dir: path.join(opts.userDataDir, 'models', 'local-asr'),
      onProgress: opts.onModelProgress,
    });
    this.recordingsDir = path.join(opts.userDataDir, 'local-asr', 'recordings');
    this.engine = new LocalAsrEngineHost({
      entry: path.join(opts.mainDir, 'localAsrWorker.js'),
      onEvent: opts.onEvent,
      onProgress: opts.onJobProgress,
      runtimePath: this.resolveRuntime() ?? RUNTIME_PACKAGE,
    });
  }

  get enginePid() {
    return this.engine.pid;
  }

  async getStatus(): Promise<LocalAsrStatus> {
    const [hardware, packs] = await Promise.all([this.getHardware(), this.models.getPackStates()]);
    return {
      hardware,
      modelDir: this.models.modelDir,
      packs,
      preferences: this.opts.getPreferences(),
    };
  }

  async getHardware(): Promise<LocalAsrHardwareInfo> {
    const cpus = os.cpus();
    let freeDiskBytes: number | undefined;
    try {
      await mkdir(this.models.modelDir, { recursive: true });
      const fsStats = await statfs(this.models.modelDir);
      freeDiskBytes = fsStats.bavail * fsStats.bsize;
    } catch {
      freeDiskBytes = undefined;
    }

    const override = this.opts.hardwareOverride ? JSON.parse(this.opts.hardwareOverride) : {};
    return assessHardware({
      arch: os.arch(),
      cpuCores: cpus.length,
      cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
      freeDiskBytes,
      platform: os.platform(),
      requiredDiskBytes: LOCAL_ASR_MODEL_PACKS.reduce((sum, pack) => sum + getPackSize(pack), 0),
      runtimeAvailable: this.isRuntimeAvailable(),
      totalMemoryBytes: os.totalmem(),
      ...override,
    });
  }

  setPreferences(patch: Partial<LocalAsrPreferences>): LocalAsrPreferences {
    const next = { ...this.opts.getPreferences(), ...patch };
    this.opts.setPreferences(next);
    return next;
  }

  async startSession(params: LocalAsrStartSessionParams): Promise<LocalAsrStartSessionResult> {
    const models = await this.requireAsrModels();
    const sessionId = randomUUID();
    let recordPath: string | undefined;
    if (params.recordAudio) {
      await mkdir(this.recordingsDir, { recursive: true });
      recordPath = path.join(this.recordingsDir, `${sessionId}.wav`);
    }

    logger.info(
      `starting session ${sessionId}: runtime=${this.resolveRuntime()} model=${models.model} vad=${models.vad}`,
    );
    this.engine.trackSession(sessionId);
    try {
      await this.engine.request('startSession', {
        language: params.language ?? this.opts.getPreferences().language,
        models,
        recordPath,
        sessionId,
      });
    } catch (error) {
      this.engine.untrackSession(sessionId);
      throw error;
    }
    return { sessionId };
  }

  pushAudio(sessionId: string, frame: ArrayBuffer | Uint8Array) {
    this.engine.sendAudio(sessionId, frame instanceof Uint8Array ? frame : new Uint8Array(frame));
  }

  async stopSession(sessionId: string): Promise<LocalAsrStopSessionResult> {
    try {
      return await this.engine.request('stopSession', { sessionId });
    } finally {
      this.engine.untrackSession(sessionId);
    }
  }

  async cancelSession(sessionId: string) {
    this.engine.untrackSession(sessionId);
    await this.engine.request('cancelSession', { sessionId });
  }

  async transcribeFile(
    params: LocalAsrTranscribeFileParams,
  ): Promise<LocalAsrTranscribeFileResult> {
    const models = await this.requireAsrModels();
    const diarize = params.diarize ?? this.opts.getPreferences().diarization;
    let diarization: DiarizationModelPaths | undefined;
    if (diarize) {
      const paths = await this.models.getReadyPaths('diarization');
      if (!paths) throw new LocalAsrError('MODEL_NOT_READY');
      diarization = {
        embedding: paths['campplus-sv-zh-en-16k.onnx'],
        segmentation: paths['pyannote-segmentation-3-0.onnx'],
      };
    }

    logger.info(
      `transcribing ${params.filePath} locally: model=${models.model} diarization=${diarization ? diarization.embedding : 'off'}`,
    );
    const result: LocalAsrTranscribeFileResult = await this.engine.request('transcribeFile', {
      diarization,
      filePath: params.filePath,
      jobId: params.jobId ?? randomUUID(),
      language: params.language ?? this.opts.getPreferences().language,
      models,
    });
    logger.info(
      `transcribed ${params.filePath}: ${result.segments.length} segments, ${result.speakers.length} speakers, ${JSON.stringify(result.stats)}`,
    );
    return result;
  }

  downloadPack(id: LocalAsrModelPackId) {
    return this.models.download(id);
  }

  dispose() {
    this.engine.dispose();
  }

  private async requireAsrModels(): Promise<AsrModelPaths> {
    if (!this.isRuntimeAvailable()) throw new LocalAsrError('RUNTIME_UNAVAILABLE');
    const paths = await this.models.getReadyPaths('asr-sensevoice');
    if (!paths) throw new LocalAsrError('MODEL_NOT_READY');
    return {
      model: paths['sense-voice-int8.onnx'],
      tokens: paths['sense-voice-tokens.txt'],
      vad: paths['silero_vad.onnx'],
    };
  }

  private isRuntimeAvailable() {
    if (!this.resolveRuntime()) return false;
    try {
      this.require.resolve(`${platformPackage()}/package.json`, {
        paths: [path.dirname(this.resolveRuntime()!)],
      });
      return true;
    } catch {
      return false;
    }
  }

  private resolveRuntime() {
    if (this.runtimePath !== undefined) return this.runtimePath;
    try {
      this.runtimePath = this.require.resolve(RUNTIME_PACKAGE);
    } catch {
      this.runtimePath = null;
    }
    return this.runtimePath;
  }
}
