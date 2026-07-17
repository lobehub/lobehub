'use client';

import { ActionIcon, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, HelpCircle, ListTodo, Loader2, RotateCcw, SendHorizonal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /* Floats over the scrolling checklist — the decision and the feedback
     channel stay reachable however deep the review goes. */
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  feedbackChip: css`
    white-space: nowrap;
  `,
  input: css`
    flex: 1;
    min-width: 160px;
  `,
}));

type BarState = 'accepted' | 'live' | 'rejected' | 'settled';

interface DecisionBarProps {
  /** Active (not-yet-consumed) feedback recorded this round. */
  feedbackCount: number;
  /** Exceptions (failed / uncertain) in the current union — colors the settled text. */
  hasException: boolean;
  onAccept: () => void;
  onOpenFeedback: () => void;
  /** Record a whole-delivery (global) feedback note; resolves true on success. */
  onSendGlobalFeedback: (comment: string) => Promise<boolean>;
  pending: boolean;
  state: BarState;
  /** The state line, prepared by the page (status + counts wording). */
  statusText: string;
  subText?: string;
}

/**
 * The floating decision strip (P-12): the round chain's state, the feedback
 * clearing list, a whole-delivery feedback inbox, and the closing accept —
 * one bottom bar owning everything the reviewer sends back or signs off.
 */
const DecisionBar = memo<DecisionBarProps>(
  ({
    feedbackCount,
    hasException,
    onAccept,
    onOpenFeedback,
    onSendGlobalFeedback,
    pending,
    state,
    statusText,
    subText,
  }) => {
    const { t } = useTranslation('verify');
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);

    const send = async () => {
      const trimmed = comment.trim();
      if (!trimmed || sending) return;
      setSending(true);
      try {
        if (await onSendGlobalFeedback(trimmed)) setComment('');
      } finally {
        setSending(false);
      }
    };

    const stateMeta = {
      accepted: { color: cssVar.colorSuccess, icon: BadgeCheck, spin: false },
      live: { color: cssVar.colorInfo, icon: Loader2, spin: true },
      rejected: { color: cssVar.colorError, icon: RotateCcw, spin: false },
      settled: {
        color: hasException ? cssVar.colorWarning : cssVar.colorSuccess,
        icon: hasException ? HelpCircle : BadgeCheck,
        spin: false,
      },
    }[state];

    return (
      <div className={styles.bar}>
        <Icon color={stateMeta.color} icon={stateMeta.icon} size={18} spin={stateMeta.spin} />
        <Flexbox gap={1} style={{ flex: 'none', maxWidth: 320, minWidth: 0 }}>
          <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
            {statusText}
          </Text>
          {subText && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {subText}
            </Text>
          )}
        </Flexbox>

        {/* The clearing list — every note this round queues for the next one. */}
        <Button
          className={styles.feedbackChip}
          icon={<Icon icon={ListTodo} />}
          size={'small'}
          type={'text'}
          onClick={onOpenFeedback}
        >
          {t('acceptance.bar.feedback', { count: feedbackCount })}
        </Button>

        {/* Whole-delivery feedback — concerns that belong to no check or group. */}
        {state !== 'accepted' && (
          <>
            <TextArea
              autoSize={{ maxRows: 3, minRows: 1 }}
              className={styles.input}
              placeholder={t('acceptance.bar.globalPlaceholder')}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <ActionIcon
              disabled={!comment.trim()}
              icon={SendHorizonal}
              loading={sending}
              size={'small'}
              title={t('acceptance.bar.send')}
              onClick={() => void send()}
            />
          </>
        )}
        {state === 'accepted' && <Flexbox flex={1} />}

        {state === 'settled' && (
          <Button disabled={pending} type={'primary'} onClick={onAccept}>
            {t('acceptance.actions.accept')}
          </Button>
        )}
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
