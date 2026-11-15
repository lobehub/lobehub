import { toast } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

type ExperimentAction = 'rerun' | 'stop';
interface ActionTarget {
  name: string;
  runId: string;
  status: string;
  /** Cases with an attempt that has no verdict; Rerun runs them again. */
  unverified: number;
}
interface ExperimentActionsOptions {
  experimentId?: string;
  onRerunStarted: () => void;
  refreshResults: () => Promise<unknown>;
  refreshRuns: () => Promise<unknown>;
  targets: ActionTarget[];
}

const isActive = (target: ActionTarget) => ['pending', 'running'].includes(target.status);
const isFinished = (target: ActionTarget) =>
  ['completed', 'failed', 'aborted'].includes(target.status);

/**
 * The experiment's two run-state actions, sent to every contender's run at once:
 * Rerun (cases without a verdict run again) and Stop. Per-run outcomes are
 * kept apart in the toasts, then both the summary and the evidence refresh.
 */
export const useExperimentActions = ({
  experimentId,
  onRerunStarted,
  refreshResults,
  refreshRuns,
  targets,
}: ExperimentActionsOptions) => {
  const { t } = useTranslation('eval');
  const [pendingAction, setPendingAction] = useState<ExperimentAction>();
  const pendingRef = useRef<ExperimentAction | undefined>(undefined);
  const currentExperiment = useRef(experimentId);
  useEffect(() => {
    currentExperiment.current = experimentId;
  }, [experimentId]);

  const rerunTargets = targets.filter((target) => target.unverified > 0 && isFinished(target));

  const execute = async (action: ExperimentAction, selected: ActionTarget[]) => {
    if (pendingRef.current || !selected.length) return;
    pendingRef.current = action;
    setPendingAction(action);
    let rerunStarted = false;
    try {
      const outcomes = await Promise.allSettled(
        selected.map((target) =>
          action === 'rerun'
            ? agentEvalService.rerunRunUnverified(target.runId)
            : agentEvalService.abortRun(target.runId),
        ),
      );
      const succeeded: string[] = [];
      const failed: ActionTarget[] = [];
      const stillRunning: ActionTarget[] = [];
      let rerunCases = 0;
      outcomes.forEach((outcome, index) => {
        const target = selected[index];
        if (outcome.status === 'fulfilled') {
          succeeded.push(target.name);
          const value = outcome.value as { rerunCount?: number } | null;
          rerunCases += typeof value?.rerunCount === 'number' ? value.rerunCount : 0;
          return;
        }
        failed.push(target);
        const message = outcome.reason instanceof Error ? outcome.reason.message : '';
        if (/status=(?:running|pending)|Cannot rerun a (?:running|pending) run/.test(message)) {
          stillRunning.push(target);
        }
        console.error(`[LobeBench] ${action} failed for ${target.runId}`, outcome.reason);
      });
      if (currentExperiment.current !== experimentId) return;
      rerunStarted = action === 'rerun' && rerunCases > 0;
      if (succeeded.length) {
        toast.success(
          t(
            action === 'rerun'
              ? 'lobeBench.dashboard.action.rerunSuccess'
              : 'lobeBench.dashboard.action.stopSuccess',
            { count: rerunCases, models: succeeded.join(', ') },
          ),
        );
      }
      if (stillRunning.length) {
        toast.error(
          t('lobeBench.dashboard.action.stillRunning', {
            models: stillRunning.map((target) => target.name).join(', '),
          }),
        );
      }
      const otherFailures = failed.filter((target) => !stillRunning.includes(target));
      if (otherFailures.length) {
        toast.error(
          t(
            action === 'rerun'
              ? 'lobeBench.dashboard.action.rerunFailed'
              : 'lobeBench.dashboard.action.failed',
            { models: otherFailures.map((target) => target.name).join(', ') },
          ),
        );
      }
    } finally {
      await Promise.allSettled([
        Promise.resolve().then(() => refreshRuns()),
        Promise.resolve().then(() => refreshResults()),
      ]);
      if (rerunStarted && currentExperiment.current === experimentId) onRerunStarted();
      pendingRef.current = undefined;
      setPendingAction(undefined);
    }
  };

  return {
    busy: pendingAction !== undefined,
    canRerun: rerunTargets.length > 0,
    pendingAction,
    rerun: () => execute('rerun', rerunTargets),
    /** Cases the rerun would run again, across the eligible contenders. */
    rerunCases: rerunTargets.reduce((sum, target) => sum + target.unverified, 0),
    stop: () => execute('stop', targets.filter(isActive)),
  };
};
