import type { UploadFileItem } from '@lobechat/types';

type RemoveFile = (id: string) => Promise<void>;

const CLEANUP_ATTEMPTS = 3;

interface ActiveSend {
  fileId: string;
  promise: Promise<void>;
}

/**
 * Owns uploaded voice files until the conversation lifecycle acknowledges them.
 *
 * The ownership boundary is independent from React and Zustand state: retries reuse the same
 * uploaded row, stale upload completions are cleaned up, and cancellation waits for an in-flight
 * send to confirm that it was not accepted before deleting its file.
 */
export class VoiceMessageUploadOwnership {
  private activeSend?: ActiveSend;
  private attemptId = 0;
  private pending?: UploadFileItem;

  constructor(private readonly removeFile: RemoveFile) {}

  private cleanupFile = async (id: string) => {
    let lastError: unknown;

    for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        await this.removeFile(id);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  };

  accept = (file: UploadFileItem) => {
    if (this.pending?.id === file.id) this.pending = undefined;
  };

  beginAttempt = () => {
    this.attemptId += 1;
    return this.attemptId;
  };

  discard = async (): Promise<'accepted' | 'discarded'> => {
    this.attemptId += 1;

    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return 'discarded';

    const activeSend = this.activeSend?.fileId === pending.id ? this.activeSend.promise : undefined;
    if (activeSend) {
      try {
        await activeSend;
        return 'accepted';
      } catch {
        // The send settled without acceptance, so this transaction still owns the file.
      }
    }

    await this.cleanupFile(pending.id);
    return 'discarded';
  };

  finishSend = (promise: Promise<void>) => {
    if (this.activeSend?.promise === promise) this.activeSend = undefined;
  };

  getPending = () => this.pending;

  isCurrent = (attemptId: number) => attemptId === this.attemptId;

  ownUploaded = async (attemptId: number, file: UploadFileItem) => {
    if (!this.isCurrent(attemptId)) {
      await this.cleanupFile(file.id);
      return false;
    }

    this.pending = file;
    return true;
  };

  trackSend = (file: UploadFileItem, promise: Promise<void>) => {
    this.activeSend = { fileId: file.id, promise };
  };
}
