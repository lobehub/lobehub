import type { LinearSyncJobErrorCode, LinearSyncJobView, LinearSyncResult } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import type { TFunction } from 'i18next';

/** Server message for a revoked or expired Linear token (`LINEAR_RECONNECT_REQUIRED`). */
const RECONNECT_REQUIRED = 'LINEAR_RECONNECT_REQUIRED';

export const linearSyncErrorMessage = (error: unknown, t: TFunction<'integration'>): string =>
  error instanceof TRPCClientError && error.message === RECONNECT_REQUIRED
    ? t('linear.sync.error.reconnect')
    : t('linear.sync.error.generic');

/** All skipped issues; the stored list stops at its cap, and older results lack the count. */
export const linearSyncSkippedCount = (result: LinearSyncResult): number =>
  result.skippedCount ?? result.skipped?.length ?? 0;

/** One-line outcome of a sync, e.g. "2 created · 1 updated · 1 closed". */
export const formatLinearSyncResult = (
  result: LinearSyncResult,
  t: TFunction<'integration'>,
): string => {
  const skipped = linearSyncSkippedCount(result);
  const parts = [
    result.created && t('linear.sync.result.created', { count: result.created }),
    result.updated && t('linear.sync.result.updated', { count: result.updated }),
    result.closed && t('linear.sync.result.closed', { count: result.closed }),
    result.keptLocalEdits &&
      t('linear.sync.result.keptLocalEdits', { count: result.keptLocalEdits }),
    skipped && t('linear.sync.result.skipped', { count: skipped }),
  ].filter(Boolean) as string[];
  if (parts.length === 0) parts.push(t('linear.sync.result.upToDate'));
  if (result.truncated) parts.push(t('linear.sync.result.truncated'));
  return parts.join(' · ');
};

export const isActiveLinearSyncJob = (job: Pick<LinearSyncJobView, 'status'>) =>
  job.status === 'pending' || job.status === 'processing';

/** Why a background sync did not finish, for the user. */
export const linearSyncJobErrorMessage = (
  code: LinearSyncJobErrorCode | null,
  t: TFunction<'integration'>,
): string => {
  switch (code) {
    case 'reconnect': {
      return t('linear.sync.error.reconnect');
    }
    case 'unavailable': {
      return t('linear.sync.job.error.unavailable');
    }
    case 'timeout': {
      return t('linear.sync.job.error.timeout');
    }
    default: {
      return t('linear.sync.error.generic');
    }
  }
};
