import { Flexbox, Icon, Tabs, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownToDot, ArrowUpFromDot, BookUp2Icon, CircleFadingArrowUp } from 'lucide-react';
import { type LobeDefaultAiModelListItem } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { getPriceLabels } from './pricing';

export const styles = stylex.create({
  container: { fontSize: '12px' },
  desc: { lineHeight: '12px', color: cssVar.colorTextDescription },
  pricing: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    fontVariantNumeric: 'tabular-nums',
  },
  // The rates stay on one line: the popover widens to fit them instead of breaking the row.
  priceItem: { whiteSpace: 'nowrap' },
});

interface ModelCardProps extends LobeDefaultAiModelListItem {
  provider: string;
}

const ModelCard = memo<ModelCardProps>(({ pricing, id, provider, displayName }) => {
  const { t } = useTranslation('chat');

  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit) && !!pricing;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const prices = getPriceLabels(pricing);

  return (
    <Flexbox gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.container).className}
        flex={1}
        gap={40}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <ModelIcon model={id} size={22} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8} style={{ lineHeight: '12px' }}>
              {displayName || id}
            </Flexbox>
            <span {...stylex.props(styles.desc)}>{provider}</span>
          </Flexbox>
        </Flexbox>
        {!!pricing && (
          <Flexbox>
            <Tabs
              activeKey={isShowCredit ? 'credit' : 'token'}
              size={'small'}
              items={[
                { key: 'token', label: 'Token' },
                {
                  key: 'credit',
                  label: (
                    <Tooltip title={t('messages.modelCard.creditTooltip')}>
                      <span>{t('messages.modelCard.credit')}</span>
                    </Tooltip>
                  ),
                },
              ]}
              onChange={(key) => {
                updateSystemStatus({ isShowCredit: key === 'credit' });
              }}
            />
          </Flexbox>
        )}
      </Flexbox>
      {isShowCredit ? (
        <Flexbox horizontal justify={'space-between'}>
          <div />
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.pricing).className}
            gap={8}
          >
            {t('messages.modelCard.creditPricing')}:
            {prices.cachedInput && (
              <Tooltip
                title={t('messages.modelCard.pricing.inputCachedTokens', {
                  amount: prices.cachedInput.amount,
                })}
              >
                <Flexbox horizontal className={stylex.props(styles.priceItem).className} gap={2}>
                  <Icon icon={CircleFadingArrowUp} />
                  {prices.cachedInput.text}
                </Flexbox>
              </Tooltip>
            )}
            {prices.writeCacheInput && (
              <Tooltip
                title={t('messages.modelCard.pricing.writeCacheInputTokens', {
                  amount: prices.writeCacheInput.amount,
                })}
              >
                <Flexbox horizontal className={stylex.props(styles.priceItem).className} gap={2}>
                  <Icon icon={BookUp2Icon} />
                  {prices.writeCacheInput.text}
                </Flexbox>
              </Tooltip>
            )}
            <Tooltip
              title={
                prices.input.amount === undefined
                  ? undefined
                  : t('messages.modelCard.pricing.inputTokens', { amount: prices.input.amount })
              }
            >
              <Flexbox horizontal className={stylex.props(styles.priceItem).className} gap={2}>
                <Icon icon={ArrowUpFromDot} />
                {prices.input.text}
              </Flexbox>
            </Tooltip>
            <Tooltip
              title={
                prices.output.amount === undefined
                  ? undefined
                  : t('messages.modelCard.pricing.outputTokens', { amount: prices.output.amount })
              }
            >
              <Flexbox horizontal className={stylex.props(styles.priceItem).className} gap={2}>
                <Icon icon={ArrowDownToDot} />
                {prices.output.text}
              </Flexbox>
            </Tooltip>
          </Flexbox>
        </Flexbox>
      ) : (
        <div style={{ height: 18 }} />
      )}
    </Flexbox>
  );
});

export default ModelCard;
