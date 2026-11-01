import { getCachedTextInputUnitRate, getWriteCacheInputUnitRate } from '@lobechat/utils';
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

import { getPrice } from './pricing';

export const styles = stylex.create({
  container: { fontSize: '12px' },
  desc: { lineHeight: '12px', color: cssVar.colorTextDescription },
  pricing: { fontSize: '12px', color: cssVar.colorTextSecondary },
});

interface ModelCardProps extends LobeDefaultAiModelListItem {
  provider: string;
}

const ModelCard = memo<ModelCardProps>(({ pricing, id, provider, displayName }) => {
  const { t } = useTranslation('chat');

  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit) && !!pricing;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const formatPrice = getPrice(pricing || { units: [] });

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
            {getCachedTextInputUnitRate(pricing) && (
              <Tooltip
                title={t('messages.modelCard.pricing.inputCachedTokens', {
                  amount: formatPrice.cachedInput,
                })}
              >
                <Flexbox horizontal gap={2}>
                  <Icon icon={CircleFadingArrowUp} />
                  {formatPrice.cachedInput}
                </Flexbox>
              </Tooltip>
            )}
            {getWriteCacheInputUnitRate(pricing) && (
              <Tooltip
                title={t('messages.modelCard.pricing.writeCacheInputTokens', {
                  amount: formatPrice.writeCacheInput,
                })}
              >
                <Flexbox horizontal gap={2}>
                  <Icon icon={BookUp2Icon} />
                  {formatPrice.writeCacheInput}
                </Flexbox>
              </Tooltip>
            )}
            <Tooltip
              title={t('messages.modelCard.pricing.inputTokens', { amount: formatPrice.input })}
            >
              <Flexbox horizontal gap={2}>
                <Icon icon={ArrowUpFromDot} />
                {formatPrice.input}
              </Flexbox>
            </Tooltip>
            <Tooltip
              title={t('messages.modelCard.pricing.outputTokens', { amount: formatPrice.output })}
            >
              <Flexbox horizontal gap={2}>
                <Icon icon={ArrowDownToDot} />
                {formatPrice.output}
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
