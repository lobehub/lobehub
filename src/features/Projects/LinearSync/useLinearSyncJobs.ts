import type { LinearSyncJobView } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { linearKeys } from '@/features/Integrations/Linear/swrKeys';
import { linearService } from '@/services/linear';

import { formatLinearSyncResult, isActiveLinearSyncJob, linearSyncJobErrorMessage } from './utils';

const POLL_MS = 2000;

/** Jobs whose outcome an open import dialog is already showing; no toast for those. */
export const jobsShownInDialog = new Set<string>();

/**
 * The project's recent background syncs. Polls only while one is still
 * running, so an idle settings page makes no requests.
 */
export const useLinearSyncJobs = (projectId: string | null) => {
  // A number, not a callback: React Compiler would freeze a closure over `data`.
  const [refreshInterval, setRefreshInterval] = useState(0);
  const swr = useSWR(
    projectId ? linearKeys.syncJobs(projectId) : null,
    () => linearService.listSyncJobs(projectId!),
    { refreshInterval },
  );
  const hasActive = !!swr.data?.some(isActiveLinearSyncJob);
  useEffect(() => setRefreshInterval(hasActive ? POLL_MS : 0), [hasActive]);
  return swr;
};

/**
 * Tell the user when a sync that was left running in the background ends —
 * the dialog that started it may be long closed.
 */
export const useLinearSyncJobNotifier = (
  jobs: LinearSyncJobView[] | undefined,
  /** Called once per finished sync, e.g. to reload the task list it wrote to. */
  onFinished?: () => void,
) => {
  const { t } = useTranslation('integration');
  const running = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!jobs) return;
    const previous = running.current;
    running.current = new Set(jobs.filter(isActiveLinearSyncJob).map((job) => job.id));
    // The first load only records what is running; it ended nothing.
    if (!previous) return;
    const finished = jobs.filter((job) => previous.has(job.id) && !isActiveLinearSyncJob(job));
    if (finished.length > 0) onFinished?.();
    for (const job of finished) {
      if (jobsShownInDialog.has(job.id)) continue;
      if (job.status === 'success' && job.result) {
        toast.success(
          t('linear.sync.job.finished', { result: formatLinearSyncResult(job.result, t) }),
        );
      } else if (job.status === 'error') {
        toast.error(linearSyncJobErrorMessage(job.error, t));
      }
    }
  }, [jobs, onFinished, t]);
};
