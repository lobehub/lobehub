import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucideImage } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { useBusinessModelRating } from '@/business/client/hooks/useBusinessModelRating';

import { getPrice } from '../../hooks/useModelDetailPanel';
import { formatPriceMultiplier, getInputPriceMultiplier } from '../../utils';
import {
  META_COLUMN_GAP,
  PRICE_COLUMN_WIDTH,
  RATING_COLORS,
  RATING_COLUMN_WIDTH,
  RATING_KEYS,
  useMetaColumns,
} from './metaColumns';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    overflow: hidden;
    flex: none;

    width: ${RATING_COLUMN_WIDTH}px;
    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  barFill: css`
    height: 100%;
    border-radius: 2px;
  `,
  price: css`
    flex: none;

    width: ${PRICE_COLUMN_WIDTH}px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
}));

interface ModelRowMetaProps {
  model: AiModelForSelect;
  provider: string;
}

/**
 * Right side of a model row: only the facts that tell models apart — benchmark
 * bars and relative input price. Abilities every model shares
 * (vision, tools, context length) live in the hover detail panel instead.
 *
 * Values carry no labels to keep rows quiet; each one's tooltip says what it
 * measures and its exact score or price.
 */
export const ModelRowMeta = memo<ModelRowMetaProps>(({ model, provider }) => {
  const { t } = useTranslation('components');
  const resolvePricing = useBusinessModelPricing();
  const resolveRating = useBusinessModelRating();

  const pricing = useMemo(
    () => resolvePricing({ model: model.id, pricing: model.pricing, provider }),
    [resolvePricing, model.id, model.pricing, provider],
  );
  const rating = useMemo(
    () => resolveRating({ model: model.id, provider }),
    [resolveRating, model.id, provider],
  );

  const columns = useMetaColumns();
  const multiplier = getInputPriceMultiplier(pricing);
  const bars = RATING_KEYS.map((key) => {
    const score = rating?.[key]?.score;
    return { key, score: typeof score === 'number' ? score : undefined };
  });

  let priceTooltip: React.ReactNode;
  if (pricing && multiplier !== undefined) {
    const isCreditPricing = provider === BRANDING_PROVIDER;
    const price = getPrice(pricing, isCreditPricing);
    const unitPrefix = isCreditPricing
      ? 'ModelSwitchPanel.detail.pricing.credits'
      : 'ModelSwitchPanel.detail.pricing';
    priceTooltip = (
      <Flexbox gap={2}>
        <span>
          {t(
            isCreditPricing ? 'ModelSwitchPanel.meta.price.credits' : 'ModelSwitchPanel.meta.price',
            { multiplier: formatPriceMultiplier(multiplier) },
          )}
        </span>
        <span>
          {[
            t(`${unitPrefix}.input` as any, { amount: price.input.current }),
            t(`${unitPrefix}.output` as any, { amount: price.output.current }),
          ].join(' · ')}
        </span>
      </Flexbox>
    );
  }

  if (!columns.rating && !columns.price) return null;

  return (
    <Flexbox horizontal align={'center'} gap={META_COLUMN_GAP} style={{ flex: 'none' }}>
      {columns.rating &&
        bars.map(({ key, score }) =>
          score === undefined ? (
            // Keep the column so values stay aligned across rows
            <div key={key} style={{ flex: 'none', width: RATING_COLUMN_WIDTH }} />
          ) : (
            <Tooltip
              key={key}
              title={t('ModelSwitchPanel.meta.rating', {
                dimension: t(`ModelSwitchPanel.detail.rating.dimension.${key}`),
                score: Math.round(score),
              })}
            >
              <div className={styles.bar}>
                <div
                  className={styles.barFill}
                  style={{
                    background: RATING_COLORS[key],
                    width: `${Math.min(100, Math.max(0, score))}%`,
                  }}
                />
              </div>
            </Tooltip>
          ),
        )}
      {columns.price &&
        (multiplier === undefined ? (
          <div style={{ flex: 'none', width: PRICE_COLUMN_WIDTH }} />
        ) : (
          <Tooltip title={priceTooltip}>
            <div className={styles.price}>
              {multiplier === 0
                ? t('ModelSwitchPanel.free')
                : `${formatPriceMultiplier(multiplier)}x`}
            </div>
          </Tooltip>
        ))}
    </Flexbox>
  );
});

ModelRowMeta.displayName = 'ModelRowMeta';

/** Marks image-generating models right after their name; rare, so it stays inline. */
export const ImageOutputMark = memo(() => {
  const { t } = useTranslation('components');

  return (
    <Tooltip title={t('ModelSelect.featureTag.imageOutput')}>
      <Icon color={cssVar.colorSuccess} icon={LucideImage} size={14} style={{ flex: 'none' }} />
    </Tooltip>
  );
});

ImageOutputMark.displayName = 'ImageOutputMark';
