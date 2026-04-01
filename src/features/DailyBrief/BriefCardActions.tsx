import { type BriefAction, DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Check, MessageCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { useBriefStore } from '@/store/brief';

import CommentInput from './CommentInput';
import { styles } from './style';

interface BriefCardActionsProps {
  briefId: string;
  briefType: string;
  resolvedAction?: string | null;
  taskId?: string | null;
}

type CommentMode = { type: 'feedback' } | { key: string; type: 'comment' };

const BriefCardActions = memo<BriefCardActionsProps>(
  ({ briefId, briefType, resolvedAction, taskId }) => {
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

    const actionSelector = useMemo(
      () => (s: { briefs: { actions: unknown; id: string }[] }) =>
        s.briefs.find((b) => b.id === briefId)?.actions as BriefAction[] | undefined,
      [briefId],
    );
    const actions = useBriefStore(actionSelector) || DEFAULT_BRIEF_ACTIONS[briefType] || [];

    const handleResolve = useCallback(
      async (key: string) => {
        setLoadingKey(key);
        try {
          await resolveBrief(briefId, key);
        } finally {
          setLoadingKey(null);
        }
      },
      [briefId, resolveBrief],
    );

    const handleCommentSubmit = useCallback(
      async (text: string) => {
        if (!commentMode) return;

        if (commentMode.type === 'comment') {
          // comment action → resolve brief with comment
          setLoadingKey(commentMode.key);
          try {
            await resolveBrief(briefId, commentMode.key, text);
          } finally {
            setLoadingKey(null);
          }
        } else {
          // feedback → just add comment, don't resolve
          if (taskId) await addComment(briefId, taskId, text);
          setFeedbackSent(true);
        }

        setCommentMode(null);
      },
      [addComment, briefId, commentMode, resolveBrief, taskId],
    );

    // Resolved state
    if (resolvedAction) {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon icon={Check} size={14} />
          <Text className={styles.resolvedTag}>{t('brief.resolved')}</Text>
        </Flexbox>
      );
    }

    // Feedback sent success state
    if (feedbackSent) {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon icon={Check} size={14} />
          <Text className={styles.resolvedTag}>{t('brief.feedbackSent')}</Text>
        </Flexbox>
      );
    }

    // Comment input mode — replaces entire actions area
    if (commentMode) {
      return <CommentInput onCancel={() => setCommentMode(null)} onSubmit={handleCommentSubmit} />;
    }

    // Default: action buttons
    return (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {actions.map((action, index) => {
          if (action.type === 'link') {
            return (
              <button
                className={styles.actionBtn}
                key={action.key}
                type="button"
                onClick={() => {
                  if (!action.url) return;
                  try {
                    const parsed = new URL(action.url);
                    if (['http:', 'https:'].includes(parsed.protocol)) {
                      window.open(action.url, '_blank', 'noopener,noreferrer');
                    }
                  } catch {
                    // invalid URL, ignore
                  }
                }}
              >
                {action.label}
              </button>
            );
          }

          if (action.type === 'comment') {
            return (
              <button
                className={styles.actionBtn}
                key={action.key}
                type="button"
                onClick={() => setCommentMode({ key: action.key, type: 'comment' })}
              >
                {action.label}
              </button>
            );
          }

          // resolve type
          return (
            <button
              className={cx(styles.actionBtn, index === 0 && styles.actionBtnPrimary)}
              disabled={loadingKey === action.key}
              key={action.key}
              type="button"
              onClick={() => handleResolve(action.key)}
            >
              {action.label}
            </button>
          );
        })}
        {taskId && (
          <button
            className={styles.actionBtn}
            type="button"
            onClick={() => setCommentMode({ type: 'feedback' })}
          >
            <Icon icon={MessageCircle} size={14} />
            {t('brief.addFeedback')}
          </button>
        )}
      </Flexbox>
    );
  },
);

export default BriefCardActions;
