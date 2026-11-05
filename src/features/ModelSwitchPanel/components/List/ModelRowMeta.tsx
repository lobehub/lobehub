import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LucideImage } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { useBusinessModelRating } from '@/business/client/hooks/useBusinessModelRating';
import { sx } from '@/styles/sx';

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

// Column widths (RATING_COLUMN_WIDTH, PRICE_COLUMN_WIDTH) are shared constants, so they go
// on the elements inline rather than into the stylesheet.
const styles = stylex.create({
  bar: {
    overflow: 'hidden',
    flex: 'none',
    height: '4px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  barFill: {
    height: '100%',
    borderRadius: '2px',
  },
  price: {
    flex: 'none',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    textAlign: 'end',
  },
});

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
              <div {...sx([styles.bar], undefined, { width: RATING_COLUMN_WIDTH })}>
                <div
                  {...sx([styles.barFill], undefined, {
                    background: RATING_COLORS[key],
                    width: `${Math.min(100, Math.max(0, score))}%`,
                  })}
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
            <div {...sx([styles.price], undefined, { width: PRICE_COLUMN_WIDTH })}>
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
