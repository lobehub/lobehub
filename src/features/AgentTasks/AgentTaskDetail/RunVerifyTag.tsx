'use client';

import type { TaskRunVerifySummary } from '@lobechat/types';
import { cssVar, Icon, Tag } from '@lobehub/ui';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
  RefreshCw,
  Stamp,
  TriangleAlert,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

/**
 * A run row's verification verdict.
 *
 * Every round in a goal loop looks alike in the feed — same title, same agent,
 * different outcome. Without this the only way to learn whether a round passed
 * is to leave the task and read the acceptance, which is exactly the trip this
 * tag saves.
 */
const VERDICT_META = {
  errored: { color: cssVar.colorError, icon: TriangleAlert, labelKey: 'errored' },
  failed: { color: cssVar.colorError, icon: CircleX, labelKey: 'failed' },
  passed: { color: cssVar.colorSuccess, icon: CircleCheck, labelKey: 'passed' },
  pending: { color: cssVar.colorTextTertiary, icon: CircleDashed, labelKey: 'pending' },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw, labelKey: 'repairing' },
  review: { color: cssVar.colorWarning, icon: Stamp, labelKey: 'review' },
  running: { color: cssVar.colorInfo, icon: Loader2, labelKey: 'running', spin: true },
} as const;

type VerdictKey = keyof typeof VERDICT_META;

/** The automatic review's outcome on a round whose checks passed. */
const REVIEW_LABEL_KEYS = {
  errored: 'reviewErrored',
  rejected: 'reviewRejected',
  unjudgeable: 'reviewUnjudgeable',
} as const;

export const resolveVerdict = (status: string | null): VerdictKey => {
  switch (status) {
    case 'errored': {
      return 'errored';
    }
    case 'failed': {
      return 'failed';
    }
    case 'passed': {
      return 'passed';
    }
    case 'running':
    case 'verifying': {
      return 'running';
    }
    // Not passed, and a repair round has to deliver again. Reading it as
    // "awaiting verification" hid that the round had already been judged.
    case 'repairing': {
      return 'repairing';
    }
    case 'delivered': {
      return 'review';
    }
    // A verify session exists but has not produced a verdict — planned, or
    // waiting on the run it verifies.
    default: {
      return 'pending';
    }
  }
};

/** What the review held back, on a round whose own verdict reads passed. */
export const reviewHoldOf = (verify: Pick<TaskRunVerifySummary, 'reviewStatus' | 'status'>) =>
  resolveVerdict(verify.status) === 'passed' ? verify.reviewStatus : undefined;

interface RunVerifyTagProps {
  verify?: TaskRunVerifySummary | null;
}

const RunVerifyTag = memo<RunVerifyTagProps>(({ verify }) => {
  const { t } = useTranslation('chat');
  // Every surface that renders a run row (task detail, and task detail inside
  // the portal) mounts a portal host, so the verdict opens beside the run
  // rather than replacing the page the reader is comparing rounds on.
  const openAcceptance = useChatStore((state) => state.openAcceptance);
  const showTaskAgentPanel = useGlobalStore((state) => state.toggleTaskAgentPanel);

  // Runs with no verification configured keep the row they have today.
  if (!verify) return null;

  const verdict = resolveVerdict(verify.status);
  // The checks passed but the review held the delivery: green would say it's done.
  const reviewHeld = reviewHoldOf(verify);
  const meta = reviewHeld
    ? { color: cssVar.colorWarning, icon: TriangleAlert, labelKey: REVIEW_LABEL_KEYS[reviewHeld] }
    : VERDICT_META[verdict];
  const round =
    verify.roundIndex == null
      ? undefined
      : t('taskDetail.runVerify.round', { index: verify.roundIndex });
  const label = t(`taskDetail.runVerify.${meta.labelKey}` as const);
  // "4/4" is what makes the verdict inspectable; a bare "passed" hides how much
  // was actually checked. Only shown once the round produced results.
  const counts = verify.total > 0 ? `${verify.passed}/${verify.total}` : undefined;
  const countsLabel = reviewHeld ? t('taskDetail.runVerify.passed') : undefined;

  return (
    <Tag
      size={'small'}
      style={{ cursor: verify.acceptanceId ? 'pointer' : undefined, flexShrink: 0 }}
      title={round ? `${round} · ${label}` : label}
      icon={
        <Icon color={meta.color} icon={meta.icon} size={12} spin={'spin' in meta && meta.spin} />
      }
      onClick={
        verify.acceptanceId
          ? (event) => {
              event.stopPropagation();
              showTaskAgentPanel(true);
              openAcceptance(verify.acceptanceId!);
            }
          : undefined
      }
    >
      {counts ? [counts, countsLabel, countsLabel && '·', label].filter(Boolean).join(' ') : label}
    </Tag>
  );
});

RunVerifyTag.displayName = 'RunVerifyTag';

export default RunVerifyTag;
