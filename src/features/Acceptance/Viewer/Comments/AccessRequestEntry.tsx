'use client';

import type { AcceptanceAccessDecision, AcceptanceCommentItem } from '@lobechat/types';
import { Button, Flexbox, Tag, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import TimelineEvent from './TimelineEvent';

const styles = stylex.create({
  hint: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
  // Same voice as a send-back's reason under its event line.
  quote: {
    borderInlineStartColor: cssVar.colorBorder,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 2,
    color: cssVar.colorText,
    fontSize: 13,
    lineHeight: 1.65,
    overflowWrap: 'anywhere',
    paddingBlock: 6,
    paddingInline: 12,
    whiteSpace: 'pre-wrap',
  },
});

const STATUS_COLOR = {
  declined: undefined,
  granted: 'success',
  pending: 'warning',
  revoked: undefined,
} as const;

/**
 * An access request in the discussion: who asked, why, where it stands, and —
 * for the acceptance's deciders — the answer, given right where the request
 * was read. A grant can be taken back from the same place.
 *
 * Kept free of the interactive discussion's modules so the read-only report can
 * render it too.
 */
const AccessRequestEntry = ({
  at,
  canManage,
  onAnswer,
  request,
}: {
  at: Date;
  /** The viewer is one of the acceptance's deciders. */
  canManage: boolean;
  onAnswer?: (id: string, decision: AcceptanceAccessDecision) => Promise<void>;
  request: AcceptanceCommentItem;
}) => {
  const { t } = useTranslation('verify');
  const [pending, setPending] = useState<AcceptanceAccessDecision>();
  const status = request.accessRequest?.status ?? 'pending';
  const reason = request.content.trim();

  const answer = async (decision: AcceptanceAccessDecision) => {
    if (!onAnswer) return;
    setPending(decision);
    try {
      await onAnswer(request.id, decision);
    } catch (cause) {
      console.error('[acceptance:access]', cause);
      toast.error(t('acceptance.access.answerFailed'));
    } finally {
      setPending(undefined);
    }
  };

  const actions =
    canManage && onAnswer
      ? status === 'pending'
        ? (['decline', 'grant'] as const)
        : status === 'granted'
          ? (['revoke'] as const)
          : []
      : [];

  return (
    <TimelineEvent
      at={at}
      icon={UsersRound}
      text={
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <span>
            {t('acceptance.access.requested', {
              name: request.author.fullName || request.author.username || '—',
            })}
          </span>
          <Tag color={STATUS_COLOR[status]} size={'small'}>
            {t(`acceptance.access.status.${status}`)}
          </Tag>
        </Flexbox>
      }
    >
      {reason && <div {...stylex.props(styles.quote)}>{reason}</div>}
      {actions.length > 0 && (
        <Flexbox gap={8}>
          {status === 'pending' && (
            <span {...stylex.props(styles.hint)}>{t('acceptance.access.grantHint')}</span>
          )}
          <Flexbox horizontal gap={8}>
            {actions.map((decision) => (
              <Button
                disabled={Boolean(pending) && pending !== decision}
                key={decision}
                loading={pending === decision}
                size={'small'}
                type={decision === 'grant' ? 'primary' : 'default'}
                onClick={() => void answer(decision)}
              >
                {t(`acceptance.access.${decision}`)}
              </Button>
            ))}
          </Flexbox>
        </Flexbox>
      )}
    </TimelineEvent>
  );
};

export default AccessRequestEntry;
