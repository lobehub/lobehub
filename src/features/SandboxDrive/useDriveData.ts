import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { sandboxStorageService } from '@/services/sandboxStorage';

const USAGE_KEY = 'sandbox-drive-usage';

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
