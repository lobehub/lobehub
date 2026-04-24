import { type BriefAction, DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import { Button, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, SquarePen } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useBriefStore } from '@/store/brief';

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
}

type CommentMode = { type: 'feedback' } | { key: string; type: 'comment' };

const SuccessTag = memo<{ label: string }>(({ label }) => (
  <Flexbox horizontal align={'center'} gap={4}>
    <Icon icon={Check} size={14} />
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
  }) => {
    const { t } = useTranslation('home');
    const [commentMode, setCommentMode] = useState<CommentMode | null>(null);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [feedbackSent, setFeedbackSent] = useState(false);
    const { addComment, resolveBrief } = useBriefStore(
      (s) => ({ addComment: s.addComment, resolveBrief: s.resolveBrief }),
      shallow,
    );

    useEffect(() => {
      if (!feedbackSent) return;
      const timer = setTimeout(() => setFeedbackSent(false), 1500);
      return () => clearTimeout(timer);
    }, [feedbackSent]);

    const actions = actionsProp ?? DEFAULT_BRIEF_ACTIONS[briefType] ?? [];

    const getActionLabel = useCallback(
      (action: BriefAction) => {
        const i18nKey = `brief.action.${action.key}`;
        const translated = t(i18nKey, { defaultValue: '' });
        return !translated || translated === i18nKey ? action.label : translated;
      },
      [t],
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
        } else {
          if (taskId) {
            await addComment(briefId, taskId, text);
            await onAfterAddComment?.();
          }
          setFeedbackSent(true);
        }

        setCommentMode(null);
      },
      [addComment, briefId, commentMode, resolveBrief, taskId, onAfterResolve, onAfterAddComment],
    );

    if (resolvedAction) return <SuccessTag label={t('brief.resolved')} />;
    if (feedbackSent) return <SuccessTag label={t('brief.feedbackSent')} />;
    if (commentMode) {
      return <CommentInput onCancel={() => setCommentMode(null)} onSubmit={handleCommentSubmit} />;
    }

    const commentActions = actions.find((a) => a.type === 'comment');
    const primaryActions = actions.find((a) => a.type !== 'comment');
    const otherActions = actions
      .filter((a) => a.type !== 'comment')
      .slice(1)
      .reverse();

    return (
      <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'} wrap={'wrap'}>
        <Flexbox horizontal align={'center'} gap={8}>
          {taskId && commentActions && (
            <Tooltip title={getActionLabel(commentActions) || t('brief.addFeedback')}>
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
              className={styles.actionBtnPrimary}
              disabled={loadingKey === primaryActions.key}
              shape={'round'}
              variant={'filled'}
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
