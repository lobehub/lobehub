import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import {
  BadgeCheck,
  CircleDashed,
  HelpCircle,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';

export const LIVE_ACCEPTANCE_STATUSES = new Set(['pending', 'planned', 'verifying', 'repairing']);

export type AcceptanceVerdictMeta = {
  bg: string;
  color: string;
  icon: typeof BadgeCheck;
  label: string;
  spin?: boolean;
};

export const resolveAcceptanceVerdictMeta = (
  status: string,
  t: TFunction<'verify'>,
): AcceptanceVerdictMeta => {
  if (status === 'repairing') {
    return {
      bg: cssVar.colorWarningBg,
      color: cssVar.colorWarning,
      icon: RefreshCw,
      label: t('acceptance.status.repairing'),
      spin: true,
    };
  }
  if (status === 'pending' || status === 'planned' || status === 'verifying') {
    return {
      bg: cssVar.colorInfoBg,
      color: cssVar.colorInfo,
      icon: Loader2,
      label: t(`acceptance.status.${status}`),
      spin: true,
    };
  }
  if (status === 'accepted') {
    return {
      bg: cssVar.colorSuccessBg,
      color: cssVar.colorSuccess,
      icon: BadgeCheck,
      label: t('acceptance.status.accepted'),
    };
  }
  if (status === 'closed') {
    return {
      bg: cssVar.colorFillSecondary,
      color: cssVar.colorTextSecondary,
      icon: X,
      label: t('acceptance.status.closed'),
    };
  }
  if (status === 'rejected') {
    return {
      bg: cssVar.colorErrorBg,
      color: cssVar.colorError,
      icon: RotateCcw,
      label: t('acceptance.status.rejected'),
    };
  }
  if (status === 'errored') {
    return {
      bg: cssVar.colorWarningBg,
      color: cssVar.colorWarning,
      icon: HelpCircle,
      label: t('acceptance.status.errored'),
    };
  }
  return {
    bg: cssVar.colorInfoBg,
    color: cssVar.colorInfo,
    icon: CircleDashed,
    label: t('acceptance.verdict.inProgress'),
  };
};

export const formatAcceptanceCountsText = (
  t: TFunction<'verify'>,
  counts: { failed: number; notExecuted: number; passed: number; uncertain: number },
) =>
  [
    t('acceptance.stats.passed', { count: counts.passed }),
    counts.uncertain > 0 ? t('acceptance.stats.uncertain', { count: counts.uncertain }) : null,
    counts.failed > 0 ? t('acceptance.stats.failed', { count: counts.failed }) : null,
    counts.notExecuted > 0
      ? t('acceptance.stats.notExecuted', { count: counts.notExecuted })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
