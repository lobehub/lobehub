import { type BriefAction, DEFAULT_BRIEF_ACTIONS, type TaskStatus } from '@lobechat/types';
import { Button, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, SquarePen, Workflow } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useBriefStore } from '@/store/brief';
import { useTaskStore } from '@/store/task';

import CommentInput from './CommentInput';
import { styles } from './style';

export interface BriefCardActionsProps {
  /** Brief actions from the brief payload — falls back to DEFAULT_BRIEF_ACTIONS by type. */
  actions?: BriefAction[] | null;
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
    briefId,
    briefType,
    onAfterAddComment,
    onAfterResolve,
    resolvedAction,
    taskId,
    taskStatus,
    topicId,
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
      // resets activeTopicDrawerTopicId on task changes.
      setActiveTaskId(taskId);
      openTopicDrawer(topicId);
    }, [openTopicDrawer, setActiveTaskId, taskId, topicId]);
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

    const actions: BriefAction[] = isResult
      ? [{ key: 'approve', label: t(resultLabelKey), type: 'resolve' }]
      : (actionsProp ?? DEFAULT_BRIEF_ACTIONS[briefType] ?? []);

    const getActionLabel = useCallback(
      (action: BriefAction) => {
        if (isResult && action.key === 'approve') return t(resultLabelKey);
        const i18nKey = `brief.action.${action.key}`;
        const translated = t(i18nKey, { defaultValue: '' });
        return !translated || translated === i18nKey ? action.label : translated;
      },
      [isResult, resultLabelKey, t],
    );

    const handleResolve = useCallback(
      async (key: string) => {
        setLoadingKey(key);
        try {
          await resolveBrief(briefId, key);
          await onAfterResolve?.();
        } finally {
          setLoadingKey(null);
        }
      },
      [briefId, resolveBrief, onAfterResolve],
    );

    const handleCommentSubmit = useCallback(
      async (text: string) => {
        if (!commentMode) return;

        if (commentMode.type === 'comment') {
          setLoadingKey(commentMode.key);
          try {
            await resolveBrief(briefId, commentMode.key, text);
            await onAfterResolve?.();
          } finally {
            setLoadingKey(null);
          }
        } else if (taskId) {
          // Free-form feedback must resolve the brief (so the heartbeat
          // re-arm gate stops blocking on this urgent brief) AND re-run
          // the task so the agent picks up `resolvedComment` next turn.
          await submitFeedback(briefId, taskId, text);
          await onAfterAddComment?.();
          await onAfterResolve?.();
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
                <Button
                  className={styles.actionBtn}
                  href={action.url}
                  key={action.key}
                  shape={'round'}
                >
                  {getActionLabel(action)}
                </Button>
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
          {primaryActions && (
            <Button
              shadow
              className={styles.actionBtnPrimary}
              disabled={loadingKey === primaryActions.key}
              shape={'round'}
              onClick={() => handleResolve(primaryActions.key)}
            >
              {getActionLabel(primaryActions)}
            </Button>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default BriefCardActions;
