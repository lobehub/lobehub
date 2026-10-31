'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Activity, CheckCircle2, Clock, Hourglass, Pause, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type ToneKey = 'default' | 'error' | 'primary' | 'success' | 'warning';

const statusConfig: Record<string, { cls: ToneKey; icon: any }> = {
  aborted: { cls: 'default', icon: Pause },
  completed: { cls: 'success', icon: CheckCircle2 },
  external: { cls: 'warning', icon: Hourglass },
  failed: { cls: 'error', icon: XCircle },
  idle: { cls: 'default', icon: Clock },
  pending: { cls: 'warning', icon: Clock },
  running: { cls: 'primary', icon: Activity },
};

const styles = stylex.create({
  default: { color: cssVar.colorTextTertiary },
  error: { color: cssVar.colorError },
  primary: { color: cssVar.colorPrimary },
  success: { color: cssVar.colorSuccess },
  warning: { color: cssVar.colorWarning },
  wrapper: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    lineHeight: 1,
  },
});

interface StatusBadgeProps {
  status: string;
}

const StatusBadge = memo<StatusBadgeProps>(({ status }) => {
  const { t } = useTranslation('eval');
  const config = statusConfig[status] || statusConfig.idle;

  return (
    <span {...stylex.props(styles.wrapper, styles[config.cls])}>
      <Icon icon={config.icon} size={12} />
      {t(`run.status.${status}` as any)}
    </span>
  );
});

export default StatusBadge;
