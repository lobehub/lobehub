import type { OnboardingUnderstandingPollingResult } from '@lobechat/types';
import { useCallback, useState } from 'react';

import { useClientPollingSWR, useOnlyFetchOnceSWR } from '@/libs/swr';
import { onboardingKeys } from '@/libs/swr/keys';
import { onboardingUnderstandingService } from '@/services/onboardingUnderstanding';

const POLL_INTERVAL = 3000;

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'partial', 'failed']);

export type UnderstandingRetryPlan =
  { kind: 'restart' } | { kind: 'retry-sources'; sessionId: string; sourceIds: string[] };

export const planUnderstandingRetry = (
  result: OnboardingUnderstandingPollingResult | undefined,
): UnderstandingRetryPlan => {
  if (!result || result.runs.length === 0) return { kind: 'restart' };

  const failedSourceIds = result.runs
    .filter((run) => run.status === 'failed' || run.status === 'stale')
    .map((run) => run.source.id);

  if (failedSourceIds.length === 0) return { kind: 'restart' };

  return { kind: 'retry-sources', sessionId: result.id, sourceIds: failedSourceIds };
};

export interface UnderstandingController {
  confirm: () => Promise<void>;
  error?: unknown;
  result?: OnboardingUnderstandingPollingResult;
  retry: () => Promise<void>;
  retrying: boolean;
}

export const useUnderstanding = (): UnderstandingController => {
  const { data: topicId, error: topicError } = useOnlyFetchOnceSWR(
    onboardingKeys.understandingTopic(),
    () => onboardingUnderstandingService.getOnboardingTopicId(),
    { shouldRetryOnError: false },
  );

  const {
    data: startResult,
    error: startError,
    mutate: restart,
  } = useOnlyFetchOnceSWR(
    topicId ? onboardingKeys.understandingStart(topicId) : null,
    () => onboardingUnderstandingService.start(topicId!),
    { shouldRetryOnError: false },
  );

  const {
    data: polledResult,
    error: pollError,
    mutate: refreshSession,
  } = useClientPollingSWR<OnboardingUnderstandingPollingResult>(
    topicId && startResult ? onboardingKeys.understandingSession(topicId) : null,
    () => onboardingUnderstandingService.getSession(topicId!),
    {
      refreshInterval: (latest) =>
        latest && TERMINAL_SESSION_STATUSES.has(latest.status) ? 0 : POLL_INTERVAL,
      shouldRetryOnError: false,
    },
  );

  const result = polledResult ?? startResult;
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    if (!topicId || retrying) return;

    setRetrying(true);
    try {
      const plan = planUnderstandingRetry(result);
      await (plan.kind === 'restart'
        ? restart()
        : Promise.allSettled(
            plan.sourceIds.map((sourceId) =>
              onboardingUnderstandingService.retrySource({
                sessionId: plan.sessionId,
                sourceId,
                topicId,
              }),
            ),
          ));
      await refreshSession();
    } finally {
      setRetrying(false);
    }
  }, [topicId, retrying, result, restart, refreshSession]);

  const confirm = useCallback(async () => {
    const display = result?.displayResult;
    if (!topicId || !result || display?.kind !== 'merged') return;

    await onboardingUnderstandingService.confirm({
      resultId: display.result.resultId,
      sessionId: result.id,
      topicId,
    });
  }, [topicId, result]);

  return {
    confirm,
    error: topicError ?? startError ?? pollError,
    result,
    retry,
    retrying,
  };
};
