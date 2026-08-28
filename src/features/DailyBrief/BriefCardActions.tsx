import { type BriefAction, DEFAULT_BRIEF_ACTIONS, type TaskStatus } from '@lobechat/types';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Check, SquarePen, Workflow } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useBriefStore } from '@/store/brief';
import { useTaskStore } from '@/store/task';

import { BriefActionLink } from './BriefActionLink';
import CommentInput from './CommentInput';
import { styles } from './style';

export interface BriefCardActionsProps {
  /** Brief actions from the brief payload — falls back to DEFAULT_BRIEF_ACTIONS by type. */
  actions?: BriefAction[] | null;
  /**
   * Agent owning the run topic. Passed through to the drawer so it opens
   * immediately instead of waiting on the task-detail fetch — which may never
   * resolve when the parent task has been deleted.
   */
  agentId?: string | null;
  briefId: string;
  briefType: string;
  /** Hook invoked after a comment is successfully posted. */
  onAfterAddComment?: () => void | Promise<void>;
  /** Hook invoked after the brief is successfully resolved. */
  onAfterResolve?: () => void | Promise<void>;
  resolvedAction?: string | null;
  taskId?: string | null;
  /** Parent task's runtime status — `scheduled` flips the result action to a plain "Confirm" since approving must NOT terminate a task parked between automated runs. */
  taskStatus?: TaskStatus | null;
  /** When set together with taskId, renders a "View run" shortcut to the topic drawer. */
  topicId?: string | null;
  /** Drawer header title until the run's activity metadata loads. */
  topicTitle?: string | null;
}

type CommentMode = { type: 'feedback' } | { key: string; type: 'comment' };

const SuccessTag = memo<{ label: string }>(({ label }) => (
  <Flexbox horizontal align={'center'} gap={4}>
    <Icon color={cssVar.colorTextQuaternary} icon={Check} size={14} />
    <Text className={styles.resolvedTag}>{label}</Text>
  </Flexbox>
));

const BriefCardActions = memo<BriefCardActionsProps>(
  ({
    actions: actionsProp,
    agentId,
    briefId,
    briefType,
    onAfterAddComment,
    onAfterResolve,
    resolvedAction,
    taskId,
    taskStatus,
    topicId,
    topicTitle,
  }) => {
    const { t } = useTranslation('home');
    const [commentMode, setCommentMode] = useState<CommentMode | null>(null);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const { resolveBrief, submitFeedback } = useBriefStore(
      (s) => ({ resolveBrief: s.resolveBrief, submitFeedback: s.submitFeedback }),
      shallow,
    );
    const { setActiveTaskId, openTopicDrawer } = useTaskStore(
      (s) => ({ openTopicDrawer: s.openTopicDrawer, setActiveTaskId: s.setActiveTaskId }),
      shallow,
    );

    const showViewRun = !!taskId && !!topicId;
    const handleViewRun = useCallback(() => {
      if (!taskId || !topicId) return;
      // setActiveTaskId hydrates `activeTaskId` so the drawer can resolve the
      // task's agentId / activity metadata (and clears any prior drawer topic
      // when switching tasks). openTopicDrawer must come after — setActiveTaskId
      // resets activeTopicDrawerTopicId AND the drawer's own agent/title, so
      // the explicit agentId has to ride this call, not precede it. Without it
      // the drawer's `open` gate stays false until the task detail fetch lands.
      setActiveTaskId(taskId);
      openTopicDrawer(topicId, {
        agentId: agentId ?? undefined,
        title: topicTitle ?? undefined,
      });
    }, [agentId, openTopicDrawer, setActiveTaskId, taskId, topicId, topicTitle]);
    const viewRunButton = showViewRun ? (
      <Button
        className={'brief-view-run-btn'}
        icon={Workflow}
        size={'small'}
        style={{ color: cssVar.colorTextSecondary }}
        type={'text'}
        onClick={handleViewRun}
      >
        {t('brief.viewRun')}
      </Button>
    ) : null;

    const isResult = briefType === 'result';
    // A result brief on a task parked at status='scheduled' is one occurrence
    // of a recurring run — approving must NOT mark the task as completed
    // (server-side guard mirrors this). Use a plain "Confirm" so the label
    // reflects the dismiss-only behavior; otherwise "Confirm complete" signals
    // the terminal transition.
    const resultLabelKey =
      taskStatus === 'scheduled' ? 'brief.action.confirm' : 'brief.action.confirmDone';

    const configuredActions: BriefAction[] = isResult
      ? [{ key: 'approve', label: t(resultLabelKey), type: 'resolve' }]
      : (actionsProp ?? DEFAULT_BRIEF_ACTIONS[briefType] ?? []);
    // A link only navigates; it does not resolve the brief. Goal-delivery
    // decisions intentionally point at the acceptance workspace, but older and
    // current rows would otherwise have no way to leave the "Needs you" queue
    // without completing that separate workflow. Keep the link primary and add
    // an explicit neutral escape hatch for any link-only decision payload.
    const actions =
      briefType === 'decision' &&
      configuredActions.some((action) => action.type === 'link') &&
      configuredActions.every((action) => action.type === 'link')
        ? [
            ...configuredActions,
            { key: 'ignore', label: t('brief.action.ignore'), type: 'resolve' as const },
          ]
        : configuredActions;

    const getActionLabel = useCallback(
      (action: BriefAction) => {
        if (isResult && action.key === 'approve') return t(resultLabelKey);
        const i18nKey = `brief.action.${action.key}`;
        const translated = t(i18nKey, { defaultValue: '' });
        return !translated || translated === i18nKey ? action.label : translated;
      },
      [isResult, resultLabelKey, t],
    );

    /**
     * Run a brief mutation and report a rejection to the user, returning whether
     * it landed.
     *
     * The tRPC client only console.errors non-401 failures, so without the toast
     * a rejected action (permission denied, brief no longer reachable, network)
     * reads as a dead button — the user clicks and nothing at all happens.
     */
    const runMutation = useCallback(
      async (mutate: () => Promise<unknown>): Promise<boolean> => {
        try {
          await mutate();
          return true;
        } catch (error) {
          toast.error((error as Error)?.message || t('brief.actionFailed'));
          return false;
        }
      },
      [t],
    );

    /**
     * Run the parent's post-action callbacks, which fire *after* the mutation has
     * already landed (`refreshActiveTask` in `TaskActivities`, list revalidation
     * elsewhere).
     *
     * A rejection here means the view is stale, not that the action failed.
     * Reporting it as a failure would tell the user to retry a resolve that
     * already succeeded — and for feedback, to re-send the comment and re-run the
     * task a second time.
     */
    const refreshAfter = useCallback(
      async (...refreshers: (undefined | (() => void | Promise<void>))[]) => {
        try {
          for (const refresh of refreshers) await refresh?.();
        } catch (error) {
          console.error('[BriefCardActions] post-action refresh failed', error);
        }
      },
      [],
    );

    const handleResolve = useCallback(
      async (key: string) => {
        setLoadingKey(key);
        try {
          if (!(await runMutation(() => resolveBrief(briefId, key)))) return;
          await refreshAfter(onAfterResolve);
        } finally {
          setLoadingKey(null);
        }
      },
      [briefId, resolveBrief, onAfterResolve, runMutation, refreshAfter],
    );

    const handleCommentSubmit = useCallback(
      async (text: string) => {
        if (!commentMode) return;

        if (commentMode.type === 'comment') {
          setLoadingKey(commentMode.key);
          try {
            // Keep the editor open on failure — closing it would discard text the
            // user typed for an action that never landed.
            if (!(await runMutation(() => resolveBrief(briefId, commentMode.key, text)))) return;
            await refreshAfter(onAfterResolve);
          } finally {
            setLoadingKey(null);
          }
        } else if (taskId) {
          // Free-form feedback must resolve the brief (so the heartbeat
          // re-arm gate stops blocking on this urgent brief) AND re-run
          // the task so the agent picks up `resolvedComment` next turn.
          if (!(await runMutation(() => submitFeedback(briefId, taskId, text)))) return;
          await refreshAfter(onAfterAddComment, onAfterResolve);
        }

        setCommentMode(null);
      },
      [
        briefId,
        commentMode,
        resolveBrief,
        submitFeedback,
        taskId,
        onAfterResolve,
        onAfterAddComment,
        runMutation,
        refreshAfter,
      ],
    );

    if (resolvedAction) {
      if (!showViewRun) return <SuccessTag label={t('brief.resolved')} />;
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          {viewRunButton}
          <SuccessTag label={t('brief.resolved')} />
        </Flexbox>
      );
    }
    if (commentMode) {
      return <CommentInput onCancel={() => setCommentMode(null)} onSubmit={handleCommentSubmit} />;
    }

    const commentActions = actions.find((a) => a.type === 'comment');
    const primaryActions = actions.find((a) => a.type !== 'comment');
    const otherActions = actions
      .filter((a) => a.type !== 'comment')
      .slice(1)
      .reverse();
    const showEditButton = !!taskId && (isResult || !!commentActions);
    const editTooltip = isResult
      ? t('brief.editResult')
      : commentActions
        ? getActionLabel(commentActions) || t('brief.addFeedback')
        : t('brief.addFeedback');

    return (
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
        {viewRunButton ?? <span />}
        <Flexbox horizontal align={'center'} gap={8}>
          {showEditButton && (
            <Tooltip title={editTooltip}>
              <Button
                className={'brief-comment-btn'}
                icon={SquarePen}
                shape={'round'}
                style={{
                  color: cssVar.colorTextSecondary,
                }}
                onClick={() => setCommentMode({ type: 'feedback' })}
              />
            </Tooltip>
          )}
          {otherActions.map((action) => {
            if (action.type === 'link') {
              return (
                <BriefActionLink
                  agentId={agentId}
                  className={styles.actionBtn}
                  key={action.key}
                  taskId={taskId}
                  url={action.url}
                >
                  {getActionLabel(action)}
                </BriefActionLink>
              );
            }

            return (
              <Button
                className={styles.actionBtn}
                disabled={loadingKey === action.key}
                key={action.key}
                shape={'round'}
                onClick={() => handleResolve(action.key)}
              >
                {getActionLabel(action)}
              </Button>
            );
          })}
          {briefType === 'error' && (
            <Button
              className={styles.actionBtn}
              disabled={loadingKey === 'ignore'}
              shape={'round'}
              onClick={() => handleResolve('ignore')}
            >
              {t('brief.action.ignore')}
            </Button>
          )}
          {primaryActions &&
            (primaryActions.type === 'link' ? (
              // A link primary (e.g. the budget-error "Upgrade" remedy) navigates
              // to its url instead of resolving the brief; render it as a filled
              // primary so the fix is the clear call to action.
              <BriefActionLink
                primary
                agentId={agentId}
                className={styles.actionBtnPrimary}
                taskId={taskId}
                url={primaryActions.url}
              >
                {getActionLabel(primaryActions)}
              </BriefActionLink>
            ) : (
              <Button
                className={styles.actionBtnPrimary}
                disabled={loadingKey === primaryActions.key}
                shape={'round'}
                onClick={() => handleResolve(primaryActions.key)}
              >
                {getActionLabel(primaryActions)}
              </Button>
            ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default BriefCardActions;
