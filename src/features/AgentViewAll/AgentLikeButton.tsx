'use client';

import type { AgentLikeStat, AgentLikeSummaries } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { HeartIcon } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentLikeKeys } from '@/libs/swr/keys';
import { agentLikeService } from '@/services/agentLike';

const styles = stylex.create({
  button: {
    alignItems: 'center',
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: 999,
    borderStyle: 'none',
    color: {
      ':hover': cssVar.colorError,
      'default': cssVar.colorTextTertiary,
    },
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    gap: 4,
    height: 24,
    lineHeight: '24px',
    outline: {
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
      'default': 'none',
    },
    paddingBlock: 0,
    paddingInline: 6,
    transform: {
      ':active': 'scale(0.92)',
      'default': 'none',
    },
    transitionDuration: cssVar.motionDurationMid,
    transitionProperty: 'color, background-color, transform',
    transitionTimingFunction: cssVar.motionEaseOutBack,
  },
  liked: {
    color: cssVar.colorError,
  },
});

/**
 * One grouped read per workspace for the whole badge wall; every card's
 * button subscribes to the same cache entry.
 */
export const useAgentLikeSummaries = (workspaceId: string | null) =>
  useClientDataSWR<AgentLikeSummaries>(
    workspaceId ? agentLikeKeys.summaries(workspaceId) : null,
    () => agentLikeService.summaries(),
    { dedupingInterval: 30_000 },
  );

const EMPTY_STAT: AgentLikeStat = { liked: false, total: 0 };

interface AgentLikeButtonProps {
  agentId: string;
  workspaceId: string;
}

/**
 * Public like counter on a badge card. Not the private favorite: every member
 * sees the same total, and only the filled state is personal.
 */
const AgentLikeButton = memo<AgentLikeButtonProps>(({ agentId, workspaceId }) => {
  const { t } = useTranslation('common');
  const { data, mutate } = useAgentLikeSummaries(workspaceId);
  // Last user-intended liked state; null when the UI matches the server.
  const targetRef = useRef<boolean | null>(null);
  const inFlightRef = useRef(false);

  const writeStat = useCallback(
    (update: (stat: AgentLikeStat) => AgentLikeStat) =>
      mutate(
        (previous) => {
          if (!previous) return previous;
          const next = update(previous[agentId] ?? EMPTY_STAT);
          const { [agentId]: _, ...rest } = previous;
          return next.total > 0 || next.liked ? { ...rest, [agentId]: next } : rest;
        },
        { revalidate: false },
      ),
    [agentId, mutate],
  );

  // Send requests until the server matches the latest intent. Clicks during a
  // request only move targetRef (the UI already flipped optimistically), so a
  // rapid like→unlike coalesces into sequential calls instead of racing.
  const drain = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let sent: boolean | undefined;
    try {
      let stat: AgentLikeStat | undefined;
      while (targetRef.current !== null && targetRef.current !== sent) {
        sent = targetRef.current;
        stat = sent ? await agentLikeService.like(agentId) : await agentLikeService.unlike(agentId);
      }
      targetRef.current = null;
      if (stat) {
        const serverStat = stat;
        await writeStat(() => serverStat);
      }
    } catch (error) {
      console.error('Failed to toggle agent like', error);
      targetRef.current = null;
      toast.error(t('agentViewAll.like.failed'));
      // Recover the truth from the server instead of guessing a rollback point
      // across coalesced clicks; a failing refetch is left to SWR's next pass.
      await mutate().catch(() => undefined);
    } finally {
      inFlightRef.current = false;
    }
  }, [agentId, mutate, t, writeStat]);

  const stat = data?.[agentId] ?? EMPTY_STAT;

  const toggle = useCallback(() => {
    if (!data) return;
    const nextLiked = !(targetRef.current ?? stat.liked);
    targetRef.current = nextLiked;
    void writeStat((previous) =>
      previous.liked === nextLiked
        ? previous
        : { liked: nextLiked, total: Math.max(0, previous.total + (nextLiked ? 1 : -1)) },
    );
    void drain();
  }, [data, drain, stat.liked, writeStat]);

  // Without the summary the state would be a guess; the heart appears once it loads.
  if (!data) return null;

  const label = stat.liked ? t('agentViewAll.like.remove') : t('agentViewAll.like.add');

  return (
    <button
      aria-label={label}
      aria-pressed={stat.liked}
      {...stylex.props(styles.button, stat.liked && styles.liked)}
      title={label}
      type={'button'}
      onClick={toggle}
    >
      <HeartIcon fill={stat.liked ? 'currentColor' : 'none'} size={14} strokeWidth={2} />
      {stat.total > 0 ? <span>{stat.total}</span> : null}
    </button>
  );
});

AgentLikeButton.displayName = 'AgentLikeButton';

export default AgentLikeButton;
