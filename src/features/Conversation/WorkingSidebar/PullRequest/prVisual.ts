import type { DeviceGitPullRequestCheck, DeviceGitPullRequestDetail } from '@lobechat/types';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  CircleXIcon,
  EyeIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import {
  getPullRequestState,
  MERGED_PURPLE,
  PR_STATE_VISUAL,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';

import type { DockRow, Tone } from './mergeDockData';

dayjs.extend(relativeTime);

export const TONE_COLOR: Record<Tone, string> = {
  error: cssVar.colorError,
  merged: MERGED_PURPLE,
  neutral: cssVar.colorTextTertiary,
  success: cssVar.colorSuccess,
  warning: cssVar.colorWarning,
};

export const DOCK_ICON: Record<DockRow['icon'], LucideIcon> = {
  behind: RefreshCwIcon,
  check: CheckIcon,
  conflict: TriangleAlertIcon,
  eye: EyeIcon,
  merge: GitMergeIcon,
  push: ArrowUpIcon,
  shieldAlert: ShieldAlertIcon,
  shieldCheck: ShieldCheckIcon,
  spinner: LoaderCircleIcon,
  x: CircleXIcon,
};

export type PullRequestVisualState = 'closed' | 'draft' | 'merged' | 'open';

export const getDetailVisual = (detail: DeviceGitPullRequestDetail) => {
  const state = getPullRequestState(detail);
  if (state === 'open' && detail.isDraft)
    return {
      color: cssVar.colorTextTertiary,
      icon: GitPullRequestDraftIcon,
      state: 'draft' as PullRequestVisualState,
    };
  return { ...PR_STATE_VISUAL[state], state: state as PullRequestVisualState };
};

export const getCheckVisual = (
  status: DeviceGitPullRequestCheck['status'],
): { icon: LucideIcon; spin?: boolean; tone: Tone } => {
  switch (status) {
    case 'pending': {
      return { icon: LoaderCircleIcon, spin: true, tone: 'warning' };
    }
    case 'failure':
    case 'cancelled': {
      return { icon: CircleXIcon, tone: 'error' };
    }
    case 'success': {
      return { icon: CircleCheckIcon, tone: 'success' };
    }
    default: {
      return { icon: CircleSlashIcon, tone: 'neutral' };
    }
  }
};

export const formatCheckDuration = (check: DeviceGitPullRequestCheck) => {
  if (!check.startedAt) return undefined;
  const seconds = Math.max(
    0,
    dayjs(check.completedAt ?? undefined).diff(check.startedAt, 'second'),
  );
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};

export const timeAgo = (iso: string) => dayjs(iso).fromNow(true);
