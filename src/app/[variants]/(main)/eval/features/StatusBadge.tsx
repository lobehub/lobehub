'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Activity, CheckCircle2, Clock, Pause, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const statusConfig: Record<string, { cls: string; icon: any }> = {
  aborted: { cls: 'default', icon: Pause },
  completed: { cls: 'success', icon: CheckCircle2 },
  failed: { cls: 'error', icon: XCircle },
  idle: { cls: 'default', icon: Clock },
  pending: { cls: 'warning', icon: Clock },
  running: { cls: 'primary', icon: Activity },
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  default: css`
    color: ${cssVar.colorTextTertiary};
  `,
  error: css`
    color: ${cssVar.colorError};
  `,
  primary: css`
    color: ${cssVar.colorPrimary};
  `,
  success: css`
    color: ${cssVar.colorSuccess};
  `,
  warning: css`
    color: ${cssVar.colorWarning};
  `,
  wrapper: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-size: 11px;
    font-weight: 500;
    line-height: 1;
  `,
}));

interface StatusBadgeProps {
  status: string;
}

const StatusBadge = memo<StatusBadgeProps>(({ status }) => {
  const { t } = useTranslation('eval');
  const config = statusConfig[status] || statusConfig.idle;

  return (
    <span className={`${styles.wrapper} ${(styles as any)[config.cls] || styles.default}`}>
      <Icon icon={config.icon} size={12} />
      {t(`run.status.${status}` as any)}
    </span>
  );
});

export default StatusBadge;
