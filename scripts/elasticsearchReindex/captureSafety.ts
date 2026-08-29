import type { SearchReindexRunState } from '../../packages/database/src/repositories/searchReindex';

const hasDurableProgress = (state: SearchReindexRunState) =>
  state.progress.some(
    ({ cursor, indexedCount, processedCount, status }) =>
      cursor !== null || indexedCount > 0 || processedCount > 0 || status !== 'pending',
  );

interface CaptureState {
  enabled: boolean;
  version: string | null;
}

export const assertSearchReindexCaptureState = (
  expectedVersion: string | null | undefined,
  capture: CaptureState,
) => {
  if (!capture.enabled || !expectedVersion || capture.version !== expectedVersion) {
    throw new Error(
      'Search sync capture changed during reindex; use a new checkpoint and an empty Elasticsearch target for a full backfill',
    );
  }
};

export const validateSearchReindexCapture = async ({
  expectedVersion,
  getCaptureState,
}: {
  expectedVersion: string | null | undefined;
  getCaptureState: () => Promise<CaptureState>;
}) => {
  const capture = await getCaptureState();
  assertSearchReindexCaptureState(expectedVersion, capture);
};

const assertSafeStart = (existing: SearchReindexRunState | undefined, capture: CaptureState) => {
  if (!existing?.run.captureVersion && capture.enabled) {
    throw new Error(
      'Cannot prepare an unactivated reindex checkpoint while capture is enabled; disable capture before retrying',
    );
  }
};

const assertSafeResume = (existing: SearchReindexRunState | undefined, capture: CaptureState) => {
  if (!existing || !hasDurableProgress(existing)) return;
  if (!capture.enabled) {
    throw new Error(
      'Cannot resume a progressed reindex checkpoint while capture is disabled; use a new checkpoint and an empty Elasticsearch target for a full backfill',
    );
  }
  if (!existing.run.captureVersion || capture.version !== existing.run.captureVersion) {
    throw new Error(
      'Cannot resume a progressed reindex checkpoint after capture state changed; use a new checkpoint and an empty Elasticsearch target for a full backfill',
    );
  }
};

/**
 * Validate resume safety and Elasticsearch mappings before enabling database capture. Once capture
 * has a gap, an old cursor can no longer prove that already-scanned rows are current.
 */
export const prepareSearchReindexCapture = async ({
  enableCapture,
  existing,
  getCaptureState,
  prepareIndices,
  setCaptureVersion,
}: {
  enableCapture: () => Promise<void>;
  existing?: SearchReindexRunState;
  getCaptureState: () => Promise<CaptureState>;
  prepareIndices: () => Promise<void>;
  setCaptureVersion: (captureVersion: string) => Promise<void>;
}) => {
  const initialCapture = await getCaptureState();
  assertSafeStart(existing, initialCapture);
  assertSafeResume(existing, initialCapture);

  await prepareIndices();
  await enableCapture();
  const capture = await getCaptureState();
  if (!capture.enabled || !capture.version) {
    throw new Error('Search sync capture did not expose an enabled version after activation');
  }
  assertSafeResume(existing, capture);
  /**
   * Persist activation evidence immediately. If interrupted before this write, the next run must
   * conservatively disable capture and reacquire the table-lock fence before it can continue.
   */
  await setCaptureVersion(capture.version);
};
