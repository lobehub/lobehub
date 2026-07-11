import type { OnboardingSuggestedTask } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { onboardingKeys } from '@/libs/swr/keys';
import { onboardingTasksService } from '@/services/onboardingTasks';

export interface StarterTaskRow {
  checked: boolean;
  id: string;
  title: string;
}

const EMPTY_TASKS: OnboardingSuggestedTask[] = [];

export const buildInitialSelection = (tasks: OnboardingSuggestedTask[]): Record<string, boolean> =>
  Object.fromEntries(tasks.map((task) => [task.id, task.checked]));

export const useStarterTasks = (onFinished: () => Promise<void>) => {
  const { data, isLoading } = useClientDataSWR<OnboardingSuggestedTask[]>(
    onboardingKeys.suggestedTasks(),
    () => onboardingTasksService.getSuggestions(),
    { shouldRetryOnError: false },
  );

  const tasks = data ?? EMPTY_TASKS;

  const [selection, setSelection] = useState<Record<string, boolean>>();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !data) return;
    initializedRef.current = true;
    setSelection(buildInitialSelection(data));
  }, [data]);

  const rows = useMemo<StarterTaskRow[]>(
    () =>
      tasks.map((task) => ({
        checked: selection?.[task.id] ?? task.checked,
        id: task.id,
        title: task.title,
      })),
    [tasks, selection],
  );

  const toggle = useCallback(
    (id: string) => {
      setSelection((prev) => {
        const base = prev ?? buildInitialSelection(tasks);
        return { ...base, [id]: !base[id] };
      });
    },
    [tasks],
  );

  const selectedCount = rows.filter((row) => row.checked).length;
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (selectedCount === 0) {
      await onFinished();
      return;
    }

    const ids = rows.filter((row) => row.checked).map((row) => row.id);

    setSubmitting(true);
    try {
      await onboardingTasksService.createTasks(ids);
      await onFinished();
    } catch {
      toast.error(t('flow.steps.starterTasks.createError', { ns: 'onboarding' }));
    } finally {
      setSubmitting(false);
    }
  }, [selectedCount, rows, onFinished]);

  return { isLoading, rows, selectedCount, submit, submitting, toggle };
};
