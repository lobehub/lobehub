import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
// Workspace-aware mutate: applies the same `augmentKey` treatment
// useClientDataSWR uses on its keys, so a mutate here actually matches the
// tray's subscription (a raw `swr` mutate would miss the augmented key).
import { mutate as scopedMutate } from '@/libs/swr/mutate';
import { verifyService } from '@/services/verify';

import { openGoalModal } from './GoalModal';
import type { TrayCheck } from './types';

/**
 * A dropped/offline connection (`fetch` rejects with a TypeError, or the browser
 * reports itself offline) versus a request the server actively rejected — the
 * two call for different copy, so the user knows whether to retry or reconnect.
 */
const isNetworkError = (error: unknown): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|failed to fetch|networkerror|load failed|err_(?:network|internet)/i.test(
    message,
  );
};

const genId = () => `chk_${Math.random().toString(36).slice(2, 10)}`;

/**
 * A topic's acceptance state: the one-sentence Goal (the outcome the
 * conversation is delivering, stored as `acceptance.requirement`) and the
 * tracking checks under it (`config.checklist`).
 */
interface TopicGoal {
  checks: TrayCheck[];
  goal: string;
}

const EMPTY: TopicGoal = { checks: [], goal: '' };

const swrKey = (topicId: string) =>
  verifyKeys.acceptanceBySubject('topic', topicId) as unknown as string;

const read = async (topicId: string): Promise<TopicGoal> => {
  const acceptance = await verifyService.getAcceptanceBySubject('topic', topicId);
  return {
    checks: (acceptance?.config?.checklist ?? []).map((c) => ({
      id: c.id,
      method: c.method ?? '',
      name: c.name,
    })),
    goal: acceptance?.requirement ?? '',
  };
};

// Optimistically publish `next` to the shared SWR key so every consumer (the
// tray + the "+" menu path) reflects it immediately, then run the write and
// revalidate. If the write fails (topic deleted mid-edit, offline, server
// error), roll the optimistic value back to the server truth and surface an
// error instead of leaving a phantom unsaved edit on screen; rethrow so the
// caller (e.g. the modal) can keep itself open rather than treating the edit as
// done.
const commit = async (topicId: string, next: TopicGoal, write: () => Promise<unknown>) => {
  await scopedMutate(swrKey(topicId), next, { revalidate: false });
  try {
    await write();
  } catch (error) {
    await scopedMutate(swrKey(topicId));
    toast.error(
      isNetworkError(error)
        ? t('acceptance.tray.saveFailed.network', { ns: 'verify' })
        : t('acceptance.tray.saveFailed.server', { ns: 'verify' }),
    );
    throw error;
  }
  await scopedMutate(swrKey(topicId));
};

const persistChecks = (topicId: string, goal: string, checks: TrayCheck[]) =>
  commit(topicId, { checks, goal }, () =>
    verifyService.saveAcceptanceChecklist(
      'topic',
      topicId,
      checks.map((c) => ({ id: c.id, method: c.method || undefined, name: c.name })),
    ),
  );

const persistGoal = (topicId: string, goal: string, checks: TrayCheck[]) =>
  commit(topicId, { checks, goal }, () => verifyService.saveAcceptanceGoal('topic', topicId, goal));

/**
 * Set the topic's Goal without a mounted tray (used by the composer "+" →
 * "Set goal" entry). Reads the current state, writes the goal, and revalidates
 * the shared SWR key so the tray reflects it.
 */
export const setTopicGoal = async (topicId: string, goal: string) => {
  const current = await read(topicId);
  await persistGoal(topicId, goal, current.checks);
};

/**
 * Open the "set goal" modal for a topic from outside a mounted tray (the
 * composer "+" menu), prefilled with the current goal so an existing one is
 * edited rather than silently overwritten.
 */
export const openTopicGoalModal = async (topicId: string) => {
  const current = await read(topicId);
  openGoalModal({
    initialGoal: current.goal || undefined,
    onSubmit: (goal) => setTopicGoal(topicId, goal),
  });
};

/**
 * The topic's Goal + tracking checks, persisted on the verify aggregate — not
 * client storage. Reads via SWR; mutations write through the acceptance router
 * and revalidate.
 */
export const useTopicGoal = (topicId: string | undefined) => {
  const { data, isLoading } = useClientDataSWR(topicId ? swrKey(topicId) : null, () =>
    read(topicId!),
  );
  const { checks, goal } = data ?? EMPTY;

  const setGoal = useCallback(
    (next: string) => {
      if (!topicId) return;
      return persistGoal(topicId, next, checks);
    },
    [topicId, checks],
  );

  const addCheck = useCallback(
    (item: { method: string; name: string }) => {
      if (!topicId) return;
      return persistChecks(topicId, goal, [...checks, { ...item, id: genId() }]);
    },
    [topicId, goal, checks],
  );

  const updateCheck = useCallback(
    (id: string, patch: Partial<Omit<TrayCheck, 'id'>>) => {
      if (!topicId) return;
      return persistChecks(
        topicId,
        goal,
        checks.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
    },
    [topicId, goal, checks],
  );

  const removeCheck = useCallback(
    (id: string) => {
      if (!topicId) return;
      return persistChecks(
        topicId,
        goal,
        checks.filter((c) => c.id !== id),
      );
    },
    [topicId, goal, checks],
  );

  return { addCheck, checks, goal, isLoading, removeCheck, setGoal, updateCheck };
};
