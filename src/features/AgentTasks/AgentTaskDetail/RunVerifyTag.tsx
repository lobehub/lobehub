'use client';

import type { TaskRunVerifySummary } from '@lobechat/types';
import { Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleCheck, CircleDashed, CircleX, Loader2, TriangleAlert } from 'lucide-react';
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
  running: { color: cssVar.colorInfo, icon: Loader2, labelKey: 'running', spin: true },
} as const;

type VerdictKey = keyof typeof VERDICT_META;

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
    // A verify session exists but has not produced a verdict — planned, or
    // waiting on the run it verifies.
    default: {
      return 'pending';
    }
  }
};

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
  const meta = VERDICT_META[verdict];
  const round =
    verify.roundIndex == null
      ? undefined
      : t('taskDetail.runVerify.round', { index: verify.roundIndex });
  const label = t(`taskDetail.runVerify.${meta.labelKey}` as const);
  // "4/4" is what makes the verdict inspectable; a bare "passed" hides how much
  // was actually checked. Only shown once the round produced results.
  const counts = verify.total > 0 ? `${verify.passed}/${verify.total}` : undefined;

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
      {counts ? `${counts} ${label}` : label}
    </Tag>
  );
});

RunVerifyTag.displayName = 'RunVerifyTag';

export default RunVerifyTag;
