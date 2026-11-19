import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { UPLOAD_NETWORK_ERROR, uploadService } from '../upload';

vi.mock('@lobechat/utils', () => ({
  uuid: () => 'mock-uuid',
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    upload: {
      abortS3MultipartUpload: { mutate: vi.fn() },
      abortS3Upload: { mutate: vi.fn() },
      completeS3MultipartUpload: { mutate: vi.fn() },
      createS3MultipartUpload: { mutate: vi.fn() },
      createS3MultipartUploadPartUrl: { mutate: vi.fn() },
      createS3PreSignedUrl: { mutate: vi.fn() },
    },
  },
}));

type PutOutcome = 'hang' | 'network-error' | 'ok' | 'timeout' | number;

/** Scripted XHR: each request takes the next outcome, then falls back to `ok`. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  static outcomes: PutOutcome[] = [];

  listeners = new Map<string, () => void>();
  status = 0;
  statusText = '';
  timeout = 0;
  upload = { addEventListener: vi.fn() };
  url?: string;

  constructor() {
    FakeXhr.instances.push(this);
  }

  addEventListener(event: string, handler: () => void) {
    this.listeners.set(event, handler);
  }

  abort = vi.fn(() => this.listeners.get('abort')?.());
  getResponseHeader = () => `etag-${FakeXhr.instances.indexOf(this)}`;
  setRequestHeader = vi.fn();

  open(_method: string, url: string) {
    this.url = url;
  }

  send() {
    const outcome = FakeXhr.outcomes.shift() ?? 'ok';
    if (outcome === 'hang') return;

    setTimeout(() => {
      if (outcome === 'network-error') return this.listeners.get('error')?.();
      if (outcome === 'timeout') return this.listeners.get('timeout')?.();

      this.status = outcome === 'ok' ? 200 : outcome;
      this.listeners.get('load')?.();
    }, 0);
  }
}

const createLargeFile = () => {
  const file = new File(['fixture'], 'video.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 });
  return file;
};

const signPart = lambdaClient.upload.createS3MultipartUploadPartUrl.mutate;
const abortMultipart = lambdaClient.upload.abortS3MultipartUpload.mutate;
const completeMultipart = lambdaClient.upload.completeS3MultipartUpload.mutate;

const lastStatus = (onProgress: ReturnType<typeof vi.fn>) => onProgress.mock.lastCall?.[0];

/** Run an upload to completion on fake timers and return its rejection, if any. */
const settle = async (upload: Promise<unknown>) => {
  const outcome = upload.then(
    () => undefined,
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
};

describe('UploadService multipart retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    FakeXhr.instances = [];
    FakeXhr.outcomes = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    let signed = 0;
    vi.mocked(lambdaClient.upload.createS3MultipartUpload.mutate).mockResolvedValue({
      partSize: 32 * 1024 * 1024,
      uploadId: 'upload-1',
    });
    vi.mocked(signPart).mockReset();
    vi.mocked(signPart).mockImplementation(async () => `https://s3.test/signed-${++signed}`);
    vi.mocked(completeMultipart).mockReset();
    vi.mocked(completeMultipart).mockResolvedValue({ success: true });
    vi.mocked(abortMultipart).mockReset();
    vi.mocked(abortMultipart).mockResolvedValue({ success: true });
    vi.mocked(lambdaClient.upload.abortS3Upload.mutate).mockReset();
    vi.mocked(lambdaClient.upload.abortS3Upload.mutate).mockResolvedValue({ success: true } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries a failed part with a newly signed URL and then succeeds', async () => {
    FakeXhr.outcomes = ['network-error', 403];
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toBeUndefined();
    // part 1 took three attempts, part 2 took one
    expect(FakeXhr.instances.map((xhr) => xhr.url)).toEqual([
      'https://s3.test/signed-1',
      'https://s3.test/signed-2',
      'https://s3.test/signed-3',
      'https://s3.test/signed-4',
    ]);
    expect(completeMultipart).toHaveBeenCalledOnce();
    expect(abortMultipart).not.toHaveBeenCalled();
    expect(lastStatus(onProgress)).toBe('success');
  });

  it('backs off exponentially between attempts', async () => {
    FakeXhr.outcomes = ['network-error', 'network-error', 'network-error'];

    const upload = uploadService.uploadToServerS3(createLargeFile(), {});
    await vi.advanceTimersByTimeAsync(1);
    expect(signPart).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(signPart).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(signPart).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(signPart).toHaveBeenCalledTimes(3);

    await settle(upload);
  });

  it('ends in error and aborts the multipart upload once retries are exhausted', async () => {
    FakeXhr.outcomes = Array.from({ length: 4 }, () => 'network-error' as const);
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(signPart).toHaveBeenCalledTimes(4);
    expect(abortMultipart).toHaveBeenCalledWith({
      pathname: expect.any(String),
      uploadId: 'upload-1',
    });
    expect(completeMultipart).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith('error', { progress: 0, restTime: 0, speed: 0 });
  });

  it('turns a part that hangs silently into error instead of waiting forever', async () => {
    FakeXhr.outcomes = Array.from({ length: 4 }, () => 'hang' as const);
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(FakeXhr.instances).toHaveLength(4);
    expect(FakeXhr.instances.every((xhr) => xhr.abort.mock.calls.length === 1)).toBe(true);
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('retries a part whose XHR timeout fires', async () => {
    FakeXhr.outcomes = ['timeout'];
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toBeUndefined();
    expect(signPart).toHaveBeenCalledTimes(3);
    expect(lastStatus(onProgress)).toBe('success');
  });

  it('keeps a slow part alive while it reports progress', async () => {
    FakeXhr.outcomes = ['hang'];
    const onProgress = vi.fn();

    const upload = uploadService.uploadToServerS3(createLargeFile(), { onProgress });
    await vi.advanceTimersByTimeAsync(1);
    const [xhr] = FakeXhr.instances;
    const onUploadProgress = xhr.upload.addEventListener.mock.calls[0][1];

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100_000);
      onUploadProgress({ lengthComputable: true, loaded: i + 1 });
    }

    expect(xhr.abort).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(1);

    await settle(upload);
  });

  it('sets a finite XHR timeout that scales with the body size', async () => {
    await settle(uploadService.uploadToServerS3(createLargeFile(), {}));

    // the 7-byte fixture slice stays at the floor
    expect(FakeXhr.instances[0].timeout).toBe(120_000);

    const part = new Blob([new Uint8Array(32 * 1024 * 1024)]);
    const file = createLargeFile();
    vi.spyOn(file, 'slice').mockReturnValue(part);
    FakeXhr.instances = [];

    await settle(uploadService.uploadToServerS3(file, {}));

    expect(FakeXhr.instances[0].timeout).toBe(1_024_000);
  });

  it('reports cancelled and does not retry when the user cancels during a part', async () => {
    FakeXhr.outcomes = ['hang'];
    const abortController = new AbortController();
    const onProgress = vi.fn();

    const upload = uploadService.uploadToServerS3(createLargeFile(), {
      abortController,
      onProgress,
    });
    await vi.advanceTimersByTimeAsync(1);
    abortController.abort();
    await settle(upload);

    expect(signPart).toHaveBeenCalledOnce();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(abortMultipart).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith('cancelled', {
      progress: 0,
      restTime: 0,
      speed: 0,
    });
  });

  it('stops waiting for the next attempt when the user cancels during backoff', async () => {
    FakeXhr.outcomes = ['network-error'];
    const abortController = new AbortController();
    const onProgress = vi.fn();

    const upload = uploadService.uploadToServerS3(createLargeFile(), {
      abortController,
      onProgress,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(signPart).toHaveBeenCalledOnce();

    abortController.abort();
    await settle(upload);

    expect(signPart).toHaveBeenCalledOnce();
    expect(lastStatus(onProgress)).toBe('cancelled');
  });

  it('keeps the original error and still reports error when aborting fails', async () => {
    FakeXhr.outcomes = Array.from({ length: 4 }, () => 'network-error' as const);
    vi.mocked(abortMultipart).mockRejectedValue(new Error('abort failed'));
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(console.error).toHaveBeenCalledWith(
      'Failed to abort S3 multipart upload:',
      expect.any(Error),
    );
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('still reports error when the cleanup calls hang', async () => {
    FakeXhr.outcomes = Array.from({ length: 4 }, () => 'network-error' as const);
    vi.mocked(abortMultipart).mockReturnValue(new Promise(() => {}));
    vi.mocked(lambdaClient.upload.abortS3Upload.mutate).mockReturnValue(new Promise(() => {}));
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('reports error when completing the upload hangs', async () => {
    vi.mocked(completeMultipart).mockReturnValue(new Promise(() => {}));
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(abortMultipart).toHaveBeenCalledOnce();
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('does not retry when the API rejects signing the part', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { data: { httpStatus: 403 } });
    vi.mocked(signPart).mockRejectedValue(forbidden);
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toEqual({ error: forbidden });
    expect(signPart).toHaveBeenCalledOnce();
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('retries signing when the API asks the client to come back later', async () => {
    const throttled = Object.assign(new Error('Too many'), { data: { httpStatus: 429 } });
    vi.mocked(signPart).mockRejectedValueOnce(throttled);
    const onProgress = vi.fn();

    const result = await settle(uploadService.uploadToServerS3(createLargeFile(), { onProgress }));

    expect(result).toBeUndefined();
    expect(lastStatus(onProgress)).toBe('success');
  });

  it('reports error for a failed single PUT and names the status when statusText is empty', async () => {
    vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue(
      'https://s3.test/single',
    );
    FakeXhr.outcomes = [500];
    const onProgress = vi.fn();
    const file = new File(['small'], 'small.png', { type: 'image/png' });

    const result = await settle(uploadService.uploadToServerS3(file, { onProgress }));

    expect(result).toEqual({ error: 'HTTP 500' });
    expect(FakeXhr.instances).toHaveLength(1);
    expect(lastStatus(onProgress)).toBe('error');
  });

  it('reports error for a failed PUT to a URL minted by someone else', async () => {
    FakeXhr.outcomes = ['network-error'];
    const onProgress = vi.fn();
    const file = new File(['small'], 'small.png', { type: 'image/png' });

    const result = await settle(
      uploadService.uploadToPresignedUrl(file, 'https://s3.test/share', { onProgress }),
    );

    expect(result).toEqual({ error: UPLOAD_NETWORK_ERROR });
    expect(lastStatus(onProgress)).toBe('error');
  });
});
