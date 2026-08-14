import { type UploadFileItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { VoiceMessageUploadOwnership } from './uploadOwnership';

const voiceFile = { id: 'voice-file', status: 'success' } as UploadFileItem;

const deferred = <T = void>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
};

describe('VoiceMessageUploadOwnership', () => {
  it('retains a failed send for retry and removes the upload only when discarded', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const ownership = new VoiceMessageUploadOwnership(removeFile);
    const attemptId = ownership.beginAttempt();
    await expect(ownership.ownUploaded(attemptId, voiceFile)).resolves.toBe(true);

    const failedSend = Promise.reject(new Error('send failed'));
    ownership.trackSend(voiceFile, failedSend);
    await expect(failedSend).rejects.toThrow('send failed');
    ownership.finishSend(failedSend);

    ownership.beginAttempt();
    expect(ownership.getPending()).toBe(voiceFile);
    expect(removeFile).not.toHaveBeenCalled();

    await expect(ownership.discard()).resolves.toBe('discarded');
    expect(removeFile).toHaveBeenCalledOnce();
    expect(removeFile).toHaveBeenCalledWith(voiceFile.id);
  });

  it('waits for an accepted in-flight send and never removes its file', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const ownership = new VoiceMessageUploadOwnership(removeFile);
    const send = deferred();
    const attemptId = ownership.beginAttempt();
    await ownership.ownUploaded(attemptId, voiceFile);
    ownership.trackSend(voiceFile, send.promise);

    const cleanup = ownership.discard();
    await Promise.resolve();
    expect(removeFile).not.toHaveBeenCalled();

    send.resolve();
    await expect(cleanup).resolves.toBe('accepted');
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('removes a rejected in-flight send once across repeated discard calls', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const ownership = new VoiceMessageUploadOwnership(removeFile);
    const send = deferred();
    const attemptId = ownership.beginAttempt();
    await ownership.ownUploaded(attemptId, voiceFile);
    ownership.trackSend(voiceFile, send.promise);

    const firstCleanup = ownership.discard();
    const secondCleanup = ownership.discard();
    send.reject(new Error('not accepted'));

    await expect(Promise.all([firstCleanup, secondCleanup])).resolves.toEqual([
      'discarded',
      'discarded',
    ]);
    expect(removeFile).toHaveBeenCalledOnce();
  });

  it('cleans up an upload that finishes after its attempt was discarded', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const ownership = new VoiceMessageUploadOwnership(removeFile);
    const attemptId = ownership.beginAttempt();

    await expect(ownership.discard()).resolves.toBe('discarded');

    await expect(ownership.ownUploaded(attemptId, voiceFile)).resolves.toBe(false);
    expect(removeFile).toHaveBeenCalledOnce();
  });

  it('retries transient cleanup failures', async () => {
    const removeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const ownership = new VoiceMessageUploadOwnership(removeFile);
    const attemptId = ownership.beginAttempt();
    await ownership.ownUploaded(attemptId, voiceFile);

    await expect(ownership.discard()).resolves.toBe('discarded');

    expect(removeFile).toHaveBeenCalledTimes(3);
  });
});
