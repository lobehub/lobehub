import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { useCallback, useEffect, useRef, useState } from 'react';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { useRefreshDrive } from '../useDriveData';
import {
  type StorageAnalysis,
  type StorageAnalysisItem,
  type StorageAnalysisResult,
  withoutDeleted,
} from './analysis';

/** Items asked for per category: enough that "select the category" covers nearly all of it. */
export const ANALYSIS_TOP = 50;

/** Pause before asking again while another call is advancing the same scan. */
const RUNNING_RETRY_MS = 2000;

/** A delete that keeps running out of time this often is reported, not retried forever. */
const MAX_DELETE_ROUNDS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DeleteOutcome {
  /** Paths the volume refused to remove; the rest were deleted. */
  failed: string[];
  freedBytes: number;
  /** Paths still there: the storage service ran out of rounds. */
  pending: string[];
}

/**
 * The drive's space analysis, scanned on mount and stepped until it is done —
 * a large drive takes several calls, and the figures counted so far are
 * shown meanwhile. `remove` deletes for good and takes the deleted items out
 * of the figures at once.
 */
export const useStorageAnalysis = (drive: SandboxDrive) => {
  const [analysis, setAnalysis] = useState<StorageAnalysis>();
  const [error, setError] = useState<unknown>();
  const [scanning, setScanning] = useState(false);
  const generation = useRef(0);
  const refreshDrive = useRefreshDrive();

  const scan = useCallback(
    async (restart = false) => {
      const run = ++generation.current;
      setScanning(true);
      setError(undefined);
      try {
        let first = true;
        for (;;) {
          const step = await sandboxStorageService.analyzeStorage({
            drive,
            restart: first && restart,
            top: ANALYSIS_TOP,
          });
          first = false;
          if (run !== generation.current) return;
          // A call answered by another scan in progress may carry no figures
          // of its own; the ones already on screen stay until it has some.
          setAnalysis((previous) =>
            step.result || !previous
              ? step
              : {
                  ...step,
                  result: previous.result,
                  scannedBytes: Math.max(step.scannedBytes, previous.scannedBytes),
                },
          );
          if (step.status === 'done') break;
          if (step.status === 'running') await sleep(RUNNING_RETRY_MS);
          if (run !== generation.current) return;
        }
      } catch (caught) {
        if (run === generation.current) setError(caught);
      } finally {
        if (run === generation.current) setScanning(false);
      }
    },
    [drive],
  );

  useEffect(() => {
    void scan();
    return () => {
      // A scan that outlives the view answers nobody.
      generation.current++;
    };
  }, [scan]);

  const remove = useCallback(
    async (items: StorageAnalysisItem[], options: { regenerableOnly?: boolean } = {}) => {
      let pending = [...new Set(items.map((item) => item.path))];
      let freedBytes = 0;
      const failed: string[] = [];
      for (let round = 0; round < MAX_DELETE_ROUNDS && pending.length > 0; round++) {
        const result = await sandboxStorageService.deleteFiles({
          drive,
          paths: pending,
          regenerableOnly: options.regenerableOnly,
        });
        freedBytes += result.freedBytes;
        failed.push(...(result.failed ?? []).map((entry) => entry.path));
        pending = result.done ? [] : result.pending;
      }

      const removed = items.filter(
        (item) => !pending.includes(item.path) && !failed.includes(item.path),
      );
      setAnalysis((current) =>
        current?.result
          ? { ...current, result: withoutDeleted(current.result as StorageAnalysisResult, removed) }
          : current,
      );
      // The usage figure was invalidated by the delete; the meter and any
      // listing reload to show the space coming back.
      await refreshDrive();

      return { failed, freedBytes, pending } satisfies DeleteOutcome;
    },
    [drive, refreshDrive],
  );

  return { analysis, error, remove, rescan: () => scan(true), scanning };
};
