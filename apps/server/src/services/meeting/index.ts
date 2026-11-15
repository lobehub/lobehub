import type { ASRPayload } from '@lobechat/model-runtime';
import type { MeetingError, UserSystemAgentConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { MeetingModel } from '@/database/models/meeting';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

import { resolveSystemAgentModelConfig } from '../systemAgent/modelConfig';
import { MeetingTranscriptionError, toMeetingErrorCode, toMeetingErrorMessage } from './errors';
import { MeetingMinutesService } from './minutes';
import { transcribeRecording } from './transcribeRecording';

const log = debug('lobe-server:meeting-transcription');

/** Base64 of one live chunk: ≤ 3 MB decoded, i.e. ~90 s of 16 kHz mono PCM WAV. */
export const MAX_LIVE_CHUNK_BASE64_CHARS = Math.ceil((3 * 1024 * 1024) / 3) * 4;

export interface LiveChunkInput {
  audioBase64: string;
  endMs: number;
  meetingId: string;
  seq: number;
  startMs: number;
}

export interface LocalRefineSegment {
  endMs: number;
  speakerLabel?: string | null;
  startMs: number;
  text: string;
}

const toLanguage = (language: string) => (language === 'auto' ? undefined : language);

/**
 * Server side of meeting transcription.
 *
 * - `refine` transcribes the stored recording end to end (speakers +
 *   timestamps), replaces the meeting's refined transcript, then generates
 *   the minutes from it (`MeetingMinutesService`).
 * - `transcribeLiveChunk` drafts one slice of a recording in progress where
 *   no realtime gateway is deployed, and stores it as a realtime segment.
 *
 * Both use the `meetingTranscription` system-agent model.
 */
export class MeetingTranscriptionService {
  private readonly meetingModel: MeetingModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.meetingModel = new MeetingModel(db, userId, workspaceId);
  }

  /**
   * Run the refine pass, then the minutes. Returns the meeting afterwards —
   * `ready` (with `error.stage = 'minutes'` if only the minutes failed), or
   * `failed` with `error` naming what to fix — or `undefined` when it is not the
   * caller's. Throws `MeetingStateError` while the meeting is still recording.
   */
  async refine(meetingId: string) {
    const meeting = await this.meetingModel.startRefine(meetingId);
    if (!meeting) return undefined;

    const startedAt = Date.now();
    try {
      if (!meeting.audioFileId) {
        throw new MeetingTranscriptionError(
          'audio_missing',
          meeting.localAudioPath
            ? 'Local recordings are refined on the device that captured them'
            : 'No recording is attached to this meeting',
        );
      }

      const audio = await this.loadAudio(meeting.audioFileId);
      const { model, transcribe } = await this.createTranscriber();
      const segments = await transcribeRecording({
        ...audio,
        language: toLanguage(meeting.language),
        model,
        onProgress: (done, total) => log('refine %s: chunk %d/%d', meetingId, done, total),
        transcribe,
      });

      const seqSegments = segments.map((segment, seq) => ({ ...segment, seq }));
      await this.meetingModel.completeRefine(meetingId, seqSegments, { next: 'summarizing' });
      log('refine %s: %d segments in %dms', meetingId, seqSegments.length, Date.now() - startedAt);
    } catch (error) {
      const meetingError: MeetingError = {
        code: toMeetingErrorCode(error),
        message: toMeetingErrorMessage(error),
        stage: 'refine',
      };
      console.error('[meeting:refine] failed', meetingId, meetingError);
      return this.meetingModel.failRefine(meetingId, meetingError);
    }

    // The final transcript is in: write the minutes from it straight away.
    return new MeetingMinutesService(this.db, this.userId, this.workspaceId).generate(meetingId);
  }

  /**
   * Desktop local mode: the device that captured the audio transcribes it with
   * speakers, so the server only ever receives text. `startLocalRefine` moves
   * the meeting to `transcribing` while the device works, `completeLocalRefine`
   * stores the device's transcript and writes the minutes, and
   * `failLocalRefine` records why the device could not finish.
   */
  async startLocalRefine(meetingId: string) {
    return this.meetingModel.startRefine(meetingId);
  }

  async completeLocalRefine(meetingId: string, segments: LocalRefineSegment[]) {
    const seqSegments = segments.map((segment, seq) => ({ ...segment, seq }));
    const meeting = await this.meetingModel.completeRefine(meetingId, seqSegments, {
      next: 'summarizing',
    });
    if (!meeting) return undefined;

    return new MeetingMinutesService(this.db, this.userId, this.workspaceId).generate(meetingId);
  }

  async failLocalRefine(meetingId: string, error: Omit<MeetingError, 'stage'>) {
    return this.meetingModel.failRefine(meetingId, { ...error, stage: 'refine' });
  }

  /**
   * Transcribe one live slice and store it as realtime segment `seq`. The same
   * `seq` replaces the stored slice, so a client retrying after a dropped
   * response never duplicates text. Throws `MeetingTranscriptionError` with
   * the code the recorder shows.
   */
  async transcribeLiveChunk(input: LiveChunkInput) {
    const meeting = await this.meetingModel.findById(input.meetingId);
    if (!meeting || meeting.userId !== this.userId) return undefined;

    const { model, transcribe } = await this.createTranscriber();
    let text: string;
    try {
      const response = await transcribe({
        ...(/diariz/i.test(model) ? { chunkingStrategy: 'auto' as const } : {}),
        file: new File([Buffer.from(input.audioBase64, 'base64') as BlobPart], 'live.wav', {
          type: 'audio/wav',
        }),
        fileName: 'live.wav',
        language: toLanguage(meeting.language),
        responseFormat: 'json',
      });
      if (!response) throw new MeetingTranscriptionError('provider_not_configured');
      text = response.text.trim();
    } catch (error) {
      if (error instanceof MeetingTranscriptionError) throw error;
      throw new MeetingTranscriptionError(toMeetingErrorCode(error), toMeetingErrorMessage(error));
    }

    // Silence still stores an empty slice so the seq is acknowledged and not retried.
    const [segment] =
      (await this.meetingModel.appendSegments(input.meetingId, [
        {
          endMs: input.endMs,
          seq: input.seq,
          source: 'realtime',
          startMs: input.startMs,
          text,
        },
      ])) ?? [];
    return segment;
  }

  private async loadAudio(fileId: string) {
    const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
    const file = await fileModel.findById(fileId);
    if (!file) throw new MeetingTranscriptionError('audio_missing', 'Recording file not found');

    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    try {
      const bytes = await fileService.getFileByteArray(file.url);
      return { bytes, fileName: file.name, mimeType: file.fileType };
    } catch (error) {
      if ((error as { Code?: string }).Code === 'NoSuchKey') {
        throw new MeetingTranscriptionError('audio_missing', 'Recording is no longer in storage');
      }
      throw error;
    }
  }

  private async createTranscriber() {
    const settings = await new UserModel(this.db, this.userId).getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
    const configured = systemAgent?.meetingTranscription;
    // An explicitly cleared slot means the user turned meeting transcription off.
    if (configured && (!configured.model || !configured.provider)) {
      throw new MeetingTranscriptionError(
        'provider_not_configured',
        'No meeting transcription model is selected',
      );
    }

    const { model, provider } = await resolveSystemAgentModelConfig({
      taskConfig: configured,
      taskKey: 'meetingTranscription',
    });
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);

    const transcribe = (payload: Omit<ASRPayload, 'model'>) =>
      runtime.transcribe(
        { ...payload, model },
        { metadata: { trigger: RequestTrigger.Asr }, user: this.userId },
      );

    return { model, provider, transcribe };
  }
}

export { MeetingTranscriptionError } from './errors';
export { MeetingMinutesService } from './minutes';
