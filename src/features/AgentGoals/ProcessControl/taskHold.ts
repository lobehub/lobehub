import { cssVar } from '@lobehub/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type ExecutionStatusVisual, TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

/**
 * A Task the coordinator holds without anyone needing to act: either its run
 * went quiet past the lease (it restarts on the next advance) or a usage window
 * refused it (it resumes after the reset). Neither is a failure, so neither
 * borrows the failed red cross.
 */
export const TASK_HOLD_VISUALS = {
  stalled: { color: cssVar.colorWarning, icon: TriangleAlert },
  waitingQuota: TASK_STATUS_VISUALS.scheduled,
} satisfies Record<string, ExecutionStatusVisual>;

/** "Resumes Sat 00:20", or "Resuming soon" once the reset has passed. */
export const useQuotaResumeText = (retryAt?: Date): string | undefined => {
  const { t, i18n } = useTranslation('chat');
  if (!retryAt) return;
  if (retryAt.getTime() <= Date.now()) return t('goalProcess.quota.resumeSoon');

  const time = new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || undefined, {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  }).format(retryAt);
  return t('goalProcess.quota.resumeAt', { time });
};
