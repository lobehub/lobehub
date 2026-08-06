import { type ModelUsage } from '@lobechat/types';
import { Center, Icon, Tooltip } from '@lobehub/ui';
import { Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CircleDollarSignIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { formatNumber } from '@/utils/format';

import { formatMessageCostUsd, resolveMessageCost } from './resolveMessageCost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    cursor: default;

    height: 28px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  chipInteractive: css`
    cursor: pointer;
  `,
  detailRow: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 140px;

    font-size: 12px;
  `,
  detailValue: css`
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  `,
}));

interface MessageCostBadgeProps {
  metadata?: Record<string, unknown> | null;
  usage?: ModelUsage;
}

const MessageCostBadge = memo<MessageCostBadgeProps>(({ usage, metadata }) => {
  const { t } = useTranslation('chat');
  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit);

  const cost = useMemo(() => resolveMessageCost(usage, metadata), [usage, metadata]);

  if (isShowCredit) return null;
  if (cost === undefined || cost <= 0) return null;

  const amount = formatMessageCostUsd(cost);
  const label = t('messageAction.cost');
  const hasTokenDetail = !!usage?.totalTokens;

  const chip = (
    <Center
      horizontal
      aria-label={`${label}: ${amount}`}
      className={hasTokenDetail ? `${styles.chip} ${styles.chipInteractive}` : styles.chip}
      gap={2}
    >
      <Icon icon={CircleDollarSignIcon} size={14} />
      <span>{amount}</span>
    </Center>
  );

  if (hasTokenDetail) {
    return (
      <Popover
        content={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
            <div className={styles.detailRow}>
              <span>{label}</span>
              <span className={styles.detailValue}>{amount}</span>
            </div>
            <div className={styles.detailRow}>
              <span>{t('messages.tokenDetails.total')}</span>
              <span className={styles.detailValue}>{formatNumber(usage!.totalTokens!)}</span>
            </div>
          </div>
        }
      >
        {chip}
      </Popover>
    );
  }

  return <Tooltip title={label}>{chip}</Tooltip>;
});

MessageCostBadge.displayName = 'MessageCostBadge';

export default MessageCostBadge;
