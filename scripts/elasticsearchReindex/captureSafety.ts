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
  assertSafeResume(existing, await getCaptureState());

  await prepareIndices();
  await enableCapture();
  const capture = await getCaptureState();
  if (!capture.enabled || !capture.version) {
    throw new Error('Search sync capture did not expose an enabled version after activation');
  }
  assertSafeResume(existing, capture);
  await setCaptureVersion(capture.version);
};
