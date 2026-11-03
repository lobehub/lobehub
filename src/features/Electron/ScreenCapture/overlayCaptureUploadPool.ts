import type { UploadFileItem } from '@/types/files/upload';

export type OverlayCaptureUploadResult = UploadFileItem | null;

interface Entry {
  promise: Promise<OverlayCaptureUploadResult>;
  reject: (reason: unknown) => void;
  resolve: (value: OverlayCaptureUploadResult) => void;
  settled: boolean;
}

const pool = new Map<string, Entry>();

const createDeferred = (): Entry => {
  let resolve!: Entry['resolve'];
  let reject!: Entry['reject'];
  const promise = new Promise<OverlayCaptureUploadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve, settled: false };
};

/**
 * Pool of per-captureId upload promises. The main renderer's upload bridge
 * populates entries on `overlayUploadRequest` and resolves them when the
 * upload pipeline settles; OverlayMessageDispatcher awaits these entries on
 * submit so `sendMessage` runs only after uploads finish.
 *
 * An entry may be created by either side first (bridge on upload request or
 * dispatcher on early submit arrival) — both paths call `ensureEntry` to
 * deduplicate on captureId.
 */
export const overlayCaptureUploadPool = {
  ensureEntry(captureId: string): Entry {
    const existing = pool.get(captureId);
    if (existing) return existing;
    const entry = createDeferred();
    pool.set(captureId, entry);
    return entry;
  },
  get(captureId: string): Entry | undefined {
    return pool.get(captureId);
  },
  resolve(captureId: string, value: OverlayCaptureUploadResult): void {
    const entry = pool.get(captureId) ?? this.ensureEntry(captureId);
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(value);
  },
  remove(captureId: string): void {
    const entry = pool.get(captureId);
    if (entry && !entry.settled) {
      entry.settled = true;
      entry.resolve(null);
    }
    pool.delete(captureId);
  },
  clear(): void {
    for (const [id, entry] of pool) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      pool.delete(id);
    }
  },
};
