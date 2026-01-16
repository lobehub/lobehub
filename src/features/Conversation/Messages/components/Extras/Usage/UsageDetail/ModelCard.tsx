import { getCachedTextInputUnitRate, getWriteCacheInputUnitRate } from '@lobechat/utils';
import { ModelIcon } from '@lobehub/icons';
import { Flexbox, Icon, Segmented, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowDownToDot, ArrowUpFromDot, BookUp2Icon, CircleFadingArrowUp } from 'lucide-react';
import { type LobeDefaultAiModelListItem } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { getPrice } from './pricing';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    container: css`
      font-size: 12px;
    `,
    desc: css`
      line-height: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    pricing: css`
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    `,
  };
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
        align={'center'}
        className={styles.container}
        flex={1}
        gap={40}
        horizontal
        justify={'space-between'}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          <ModelIcon model={id} size={22} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox align={'center'} gap={8} horizontal style={{ lineHeight: '12px' }}>
              {displayName || id}
            </Flexbox>
            <span className={styles.desc}>{provider}</span>
          </Flexbox>
        </Flexbox>
        {!!pricing && (
          <Flexbox>
            <Segmented
              onChange={(value) => {
                updateSystemStatus({ isShowCredit: value === 'credit' });
              }}
              options={[
                { label: 'Token', value: 'token' },
                {
                  label: (
                    <Tooltip title={t('messages.modelCard.creditTooltip')}>
                      <span>{t('messages.modelCard.credit')}</span>
                    </Tooltip>
                  ),
                  value: 'credit',
                },
              ]}
              size={'small'}
              value={isShowCredit ? 'credit' : 'token'}
            />
          </Flexbox>
        )}
      </Flexbox>
      {isShowCredit ? (
        <Flexbox horizontal justify={'space-between'}>
          <div />
          <Flexbox align={'center'} className={styles.pricing} gap={8} horizontal>
            {t('messages.modelCard.creditPricing')}:
            {getCachedTextInputUnitRate(pricing) && (
              <Tooltip
                title={t('messages.modelCard.pricing.inputCachedTokens', {
                  amount: formatPrice.cachedInput,
                })}
              >
                <Flexbox gap={2} horizontal>
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
                <Flexbox gap={2} horizontal>
                  <Icon icon={BookUp2Icon} />
                  {formatPrice.writeCacheInput}
                </Flexbox>
              </Tooltip>
            )}
            <Tooltip
              title={t('messages.modelCard.pricing.inputTokens', { amount: formatPrice.input })}
            >
              <Flexbox gap={2} horizontal>
                <Icon icon={ArrowUpFromDot} />
                {formatPrice.input}
              </Flexbox>
            </Tooltip>
            <Tooltip
              title={t('messages.modelCard.pricing.outputTokens', { amount: formatPrice.output })}
            >
              <Flexbox gap={2} horizontal>
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
