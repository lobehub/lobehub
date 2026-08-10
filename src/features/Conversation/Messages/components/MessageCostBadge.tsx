import { type ModelPerformance, type ModelUsage } from '@lobechat/types';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CoinsIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { formatNumber } from '@/utils/format';

import { formatMessageCostUsd, resolveMessageCost } from './resolveMessageCost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    cursor: pointer;

    width: 28px;
    height: 28px;
    border-radius: 6px;

    color: ${cssVar.colorText};

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  costValue: css`
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  detailRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    min-width: 200px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  detailValue: css`
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  sectionTitle: css`
    margin-block-end: 4px;
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextDescription};
  `,
}));

type DetailRow = { key: string; label: string; value: string };

const buildUsageDetailRows = (
  usage: ModelUsage | undefined,
  performance: ModelPerformance | undefined,
  t: (key: string) => string,
): DetailRow[] => {
  if (!usage) return [];

  const rows: DetailRow[] = [];
  const push = (key: string, label: string, value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    rows.push({ key, label, value: formatNumber(value) });
  };

  push('input', t('messages.tokenDetails.inputTitle'), usage.totalInputTokens);
  push('inputText', t('messages.tokenDetails.inputText'), usage.inputTextTokens);
  push('inputCached', t('messages.tokenDetails.inputCached'), usage.inputCachedTokens);
  push(
    'inputWriteCached',
    t('messages.tokenDetails.inputWriteCached'),
    usage.inputWriteCacheTokens,
  );
  push('inputUncached', t('messages.tokenDetails.inputUncached'), usage.inputCacheMissTokens);
  push('inputAudio', t('messages.tokenDetails.inputAudio'), usage.inputAudioTokens);
  push('inputCitation', t('messages.tokenDetails.inputCitation'), usage.inputCitationTokens);
  push('inputTool', t('messages.tokenDetails.inputTool'), usage.inputToolTokens);

  push('output', t('messages.tokenDetails.outputTitle'), usage.totalOutputTokens);
  push('outputText', t('messages.tokenDetails.outputText'), usage.outputTextTokens);
  push('reasoning', t('messages.tokenDetails.reasoning'), usage.outputReasoningTokens);
  push('outputAudio', t('messages.tokenDetails.outputAudio'), usage.outputAudioTokens);
  push('outputImage', t('messages.tokenDetails.outputImage'), usage.outputImageTokens);

  push('total', t('messages.tokenDetails.total'), usage.totalTokens);

  if (performance?.tps) {
    rows.push({
      key: 'tps',
      label: t('messages.tokenDetails.speed.tps.title'),
      value: formatNumber(performance.tps, 1),
    });
  }
  if (performance?.ttft) {
    rows.push({
      key: 'ttft',
      label: t('messages.tokenDetails.speed.ttft.title'),
      value: `${formatNumber(performance.ttft / 1000, 2)}s`,
    });
  }

  return rows;
};

interface MessageCostBadgeProps {
  metadata?: Record<string, unknown> | null;
  performance?: ModelPerformance;
  usage?: ModelUsage;
}

const MessageCostBadge = memo<MessageCostBadgeProps>(({ usage, metadata, performance }) => {
  const { t } = useTranslation('chat');
  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit);

  const cost = useMemo(() => resolveMessageCost(usage, metadata), [usage, metadata]);
  const detailRows = useMemo(
    () => buildUsageDetailRows(usage, performance, t),
    [usage, performance, t],
  );

  if (isShowCredit) return null;
  if (cost === undefined || cost <= 0) return null;

  const amount = formatMessageCostUsd(cost);
  const label = t('messageAction.cost');

  return (
    <Popover
      placement="top"
      trigger="hover"
      content={
        <Flexbox gap={12} style={{ minWidth: 220, padding: 4 }}>
          <div>
            <div className={styles.sectionTitle}>{label}</div>
            <div className={styles.costValue}>{amount}</div>
          </div>

          {detailRows.length > 0 && (
            <Flexbox gap={6}>
              {detailRows.map((row) => (
                <div className={styles.detailRow} key={row.key}>
                  <span>{row.label}</span>
                  <span className={styles.detailValue}>{row.value}</span>
                </div>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      }
    >
      <Center horizontal aria-label={`${label}: ${amount}`} className={styles.chip}>
        <Icon icon={CoinsIcon} size={14} />
      </Center>
    </Popover>
  );
});

MessageCostBadge.displayName = 'MessageCostBadge';

export default MessageCostBadge;
