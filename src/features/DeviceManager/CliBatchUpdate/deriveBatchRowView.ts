import type {
  DeviceCliBatchEntry,
  DeviceCliBatchOutcome,
  DeviceCliUpdateStateResult,
} from '@lobechat/types';

import { deriveCliUpdateView } from '../CliUpdate/deriveCliUpdateView';

/**
 * One device row of a batch CLI update: the plan or skip reason it was given,
 * or — once its restart was requested — where that update stands.
 */
export type BatchRowView =
  Exclude<DeviceCliBatchOutcome, 'requested'> | 'pending' | 'success' | 'timedOut';

/**
 * Follow a requested update with the same rule as a single-device update: it
 * succeeds only when a new CLI process reports the target version.
 */
export const deriveBatchRowView = (
  entry: DeviceCliBatchEntry,
  follow?: DeviceCliUpdateStateResult,
  timedOut = false,
): BatchRowView => {
  if (entry.outcome !== 'requested') return entry.outcome;
  if (!entry.operation) return 'pending';
  const view = deriveCliUpdateView(follow, entry.operation, timedOut);
  return view === 'success' || view === 'failed' || view === 'timedOut' ? view : 'pending';
};

/** Rows that will never change on their own once the batch is sent. */
export const isSettledRowView = (view: BatchRowView) => view !== 'pending';

export interface BatchSummary {
  failed: number;
  pending: number;
  ready: number;
  skipped: number;
  updated: number;
}

export const summarizeBatch = (views: BatchRowView[]): BatchSummary => {
  const summary: BatchSummary = { failed: 0, pending: 0, ready: 0, skipped: 0, updated: 0 };
  for (const view of views) {
    if (view === 'ready') summary.ready++;
    else if (view === 'pending') summary.pending++;
    else if (view === 'success') summary.updated++;
    else if (view === 'failed' || view === 'timedOut') summary.failed++;
    else summary.skipped++;
  }
  return summary;
};
