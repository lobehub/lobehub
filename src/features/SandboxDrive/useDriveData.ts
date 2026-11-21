import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { sandboxStorageService } from '@/services/sandboxStorage';

const USAGE_KEY = 'sandbox-drive-usage';

/**
 * How many refresh calls one measurement keeps going for while a large drive
 * is still being walked. Each call walks for up to about half a minute on the
 * server, so this follows a walk for several minutes; past it, the measurement
 * cron finishes the walk and the next visit shows the result.
 */
export const MAX_MEASURE_CALLS = 12;

/**
 * Pause between those calls. A call normally spends its time walking on the
 * server; when another caller holds the walk it answers at once, and without
 * a pause the loop would spend all its calls in a second.
 */
export const MEASURE_CALL_GAP_MS = 3000;

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nobody is looking: the measurement cron finishes the walk without this tab. */
export const pageHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * A refresh of a drive too large to measure in one go: the
 * execution plane walks it over several calls and, until the walk ends, says
 * how much it has counted so far beside the last finished figure.
 */
interface UsageMeasurement {
  scannedBytes: number | null;
  status: 'measuring';
}

const measurementOf = (info: unknown): UsageMeasurement | undefined => {
  const measurement = (info as { usageMeasurement?: Partial<UsageMeasurement> } | null)
    ?.usageMeasurement;
  return measurement?.status === 'measuring'
    ? { scannedBytes: measurement.scannedBytes ?? null, status: 'measuring' }
    : undefined;
};

/** What a usage refresh found: still measuring, and how much it has counted so far. */
export interface DriveUsageRefreshResult {
  measuring?: {
    /** The drives whose walk needs more calls: the only ones to call again. */
    drives: SandboxDrive[];
    scannedBytes: number | null;
  };
}
const FILES_KEY = 'sandbox-drive-files';

/**
 * Every drive's usage against the pool, and each member's for an admin.
 * `useClientDataSWR` keys it by the active workspace, so switching workspaces
 * never shows the previous one's figures.
 */
export const useDriveUsage = () => {
  const swr = useClientDataSWR<Awaited<ReturnType<typeof sandboxStorageService.getDriveUsage>>>(
    [USAGE_KEY],
    () => sandboxStorageService.getDriveUsage(),
    { revalidateOnFocus: false },
  );

  // Measuring walks each of the caller's own drives; the members' figures are
  // whatever was last measured for them. Every drive is measured even when one
  // fails, and the figures are reloaded either way; then a failure is thrown,
  // so the caller can say the refresh did not fully work. A drive whose walk
  // needs more calls is reported as still measuring, with what it has counted;
  // passing those drives back measures only them, not the finished ones again.
  const refresh = useCallback(
    async (only?: SandboxDrive[]): Promise<DriveUsageRefreshResult> => {
      const drives = only ?? swr.data?.drives.map((entry) => entry.drive) ?? [];
      const results = await Promise.allSettled(
        drives.map((drive) => sandboxStorageService.refreshStorageUsage({ drive })),
      );
      await swr.mutate();

      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;

      const measuring = results.flatMap((result, index) => {
        const measurement = result.status === 'fulfilled' ? measurementOf(result.value) : undefined;
        return measurement ? [{ drive: drives[index], measurement }] : [];
      });
      if (measuring.length === 0) return {};
      const counted = measuring
        .map(({ measurement }) => measurement)
        .filter((measurement) => measurement.scannedBytes !== null);
      return {
        measuring: {
          drives: measuring.map(({ drive }) => drive),
          scannedBytes:
            counted.length > 0
              ? counted.reduce((sum, measurement) => sum + measurement.scannedBytes!, 0)
              : null,
        },
      };
    },
    [swr.data, swr.mutate],
  );

  return { data: swr.data, error: swr.error, isLoading: swr.isLoading, refresh };
};

/** One folder's entries on one drive. */
export const useDriveFiles = (drive: SandboxDrive, path: string) =>
  useClientDataSWR<Awaited<ReturnType<typeof sandboxStorageService.listFiles>>>(
    [FILES_KEY, drive, path],
    () => sandboxStorageService.listFiles({ drive, path: path || undefined }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

/** Refetch every listing of every drive, and the usage, after a write. */
export const useRefreshDrive = () => {
  const { mutate } = useSWRConfig();

  return useCallback(
    () => mutate((key) => Array.isArray(key) && (key[0] === FILES_KEY || key[0] === USAGE_KEY)),
    [mutate],
  );
};

/**
 * Measure a drive again after something was deleted from it, in the
 * background.
 *
 * A delete only marks the stored figure stale; the usage read keeps returning
 * the figure measured before it until something measures again. Reloading the
 * usage alone would show the space as still taken, so walk the drive — over
 * several calls when it is large — and reload the usage after each one. The
 * delete has already happened: a measurement that fails leaves the old figure,
 * and the user can still refresh it by hand.
 */
export const useRemeasureDrive = () => {
  const { mutate } = useSWRConfig();

  return useCallback(
    /**
     * `startedIn`: the workspace active when the delete began — capture it
     * before awaiting the delete, so a switch while it runs is noticed.
     */
    async (drive: SandboxDrive, startedIn: string | null = getActiveWorkspaceId()) => {
      // Requests go to whichever workspace is active: a walk for a delete made
      // in one must not run, or carry on, in the next.
      const workspaceId = startedIn;
      try {
        for (let call = 0; call < MAX_MEASURE_CALLS; call++) {
          if (call > 0) {
            await wait(MEASURE_CALL_GAP_MS);
            if (pageHidden()) return;
          }
          if (getActiveWorkspaceId() !== workspaceId) return;
          const result = await sandboxStorageService.refreshStorageUsage({ drive });
          if (getActiveWorkspaceId() !== workspaceId) return;
          await mutate((key) => Array.isArray(key) && key[0] === USAGE_KEY);
          if (!measurementOf(result)) return;
        }
      } catch {
        // Best-effort: see above.
      }
    },
    [mutate],
  );
};
