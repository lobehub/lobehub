import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownToDot, ArrowUpFromDot, CircleFadingArrowUp } from 'lucide-react';
import type { FC } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnabledProviderWithModels } from '@/types/aiProvider';
import { getModelDescriptionI18nKey } from '@/utils/modelDescriptionI18n';

import type { FormattedUnitPrice } from '../hooks/useModelDetailPanel';
import { UNIT_ICON_MAP, useModelDetailPanel } from '../hooks/useModelDetailPanel';
import type { PricingMode } from '../types';
import { openBenchmarkModal } from './BenchmarkModal';
import type { RadarDimensionDatum } from './ModelRatingRadar';
import ModelRatingRadar, {
  RADAR_MIN_DIMENSIONS,
  RATING_DIMENSION_ORDER,
  RATING_SOURCE_NAMES,
} from './ModelRatingRadar';

export type { PricingMode } from '../types';

const styles = stylex.create({
  actionText: {
    fontSize: '14px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
  container: {
    paddingBlockEnd: '8px',
  },
  description: {
    margin: 0,
    paddingBlock: '8px',
    paddingInline: '8px',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  radarClickable: {
    cursor: 'pointer',
    borderRadius: '8px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: `background 0.2s ${cssVar.motionEaseInOut}`,
  },
  ratingScoreLink: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontWeight: 600,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
  },
  row: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  originalPriceText: {
    color: cssVar.colorTextTertiary,
    textDecoration: 'line-through',
  },
  priceValue: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'baseline',
  },
  titleText: {
    fontSize: '14px',
    fontWeight: 400,
    color: cssVar.colorTextSecondary,
  },
});

interface PriceValueProps {
  prefix?: string;
  price: FormattedUnitPrice;
  suffix?: string;
}

const PriceValue: FC<PriceValueProps> = ({ price, prefix = '', suffix = '' }) => (
  <span {...stylex.props(styles.priceValue)}>
    {price.original && (
      <span data-testid={'original-price'} {...stylex.props(styles.originalPriceText)}>
        {prefix}
        {price.original}
      </span>
    )}
    <span>
      {prefix}
      {price.current}
      {suffix}
    </span>
  </span>
);

interface ModelDetailPanelProps {
  enabledList?: EnabledProviderWithModels[];
  model?: string;
  pricingMode?: PricingMode;
  provider?: string;
}

const ModelDetailPanel: FC<ModelDetailPanelProps> = memo(
  ({ model: modelId, provider, enabledList: enabledListProp, pricingMode }) => {
    const { t } = useTranslation(['components', 'models']);
    const {
      approximatePriceLabel,
      contextWindowLabel,
      enabledAbilities,
      expandedKeys,
      formatPrice,
      formatUnitPrice,
      getPricingTooltip,
      getUnitPriceSuffix,
      handleExpandedChange,
      hasAbilities,
      hasCachedInputPricing,
      hasPricing,
      isAbilitiesExpanded,
      isCreditPricing,
      isPricingExpanded,
      model,
      pricingGroups,
      rating,
    } = useModelDetailPanel({
      enabledList: enabledListProp,
      modelId,
      pricingMode,
      provider,
      t,
    });

    if (!model) return null;

    const ratingDimensions: RadarDimensionDatum[] = rating
      ? RATING_DIMENSION_ORDER.map((key) => {
          const dimension = rating[key];

          return {
            key,
            label: String(t(`ModelSwitchPanel.detail.rating.dimension.${key}` as any)),
            score: dimension?.score,
            sourceUrl: dimension?.sourceUrl,
            tooltip: dimension
              ? `${RATING_SOURCE_NAMES[dimension.source]}${
                  dimension.raw === undefined ? '' : ` · ${dimension.raw}`
                }`
              : undefined,
          };
        })
      : [];
    const ratedDimensions = ratingDimensions.filter((item) => item.score !== undefined);
    const hasRating = ratedDimensions.length > 0;

    // Model ids can contain `:` (e.g. `gemini-3-pro-image-preview:image`). i18next
    // defaults nsSeparator to `:`, so without disabling it the lookup splits into the
    // wrong namespace and never hits `models.lobehub.<id>.description`.
    const description = model.description
      ? String(
          t(getModelDescriptionI18nKey(model.id, provider) as any, {
            defaultValue: model.description,
            keySeparator: false,
            ns: 'models',
            nsSeparator: false,
          }),
        ).trim()
      : undefined;

    return (
      <Flexbox className={stylex.props(styles.container).className}>
        {description && (
          <Text
            as={'p'}
            className={stylex.props(styles.description).className}
            data-testid={'model-description'}
            fontSize={12}
            type={'secondary'}
          >
            {description}
          </Text>
        )}
        {/* Sections */}
        {(hasRating || hasPricing || contextWindowLabel || hasAbilities) && (
          <AccordionRoot
            indicatorPlacement="inline"
            style={{ gap: 8 }}
            value={expandedKeys}
            onValueChange={handleExpandedChange}
          >
            {/* Benchmarks */}
            {hasRating && (
              <AccordionItem value="rating">
                <AccordionHeader>
                  <AccordionTrigger style={{ paddingBlock: 6, paddingInline: 8 }}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <div
                        style={{
                          background: '#eb2f96',
                          borderRadius: 2,
                          flexShrink: 0,
                          height: 14,
                          width: 3,
                        }}
                      />
                      <span {...stylex.props(styles.titleText)}>
                        {t('ModelSwitchPanel.detail.rating')}
                      </span>
                    </Flexbox>
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel>
                  <Flexbox gap={4}>
                    {ratedDimensions.length >= RADAR_MIN_DIMENSIONS ? (
                      <Tooltip title={t('ModelSwitchPanel.detail.rating.clickHint')}>
                        <div
                          {...stylex.props(styles.radarClickable)}
                          role={'button'}
                          tabIndex={0}
                          onClick={() => {
                            if (provider) openBenchmarkModal({ modelId: model.id, provider });
                          }}
                        >
                          <ModelRatingRadar dimensions={ratingDimensions} />
                        </div>
                      </Tooltip>
                    ) : (
                      <Flexbox gap={4}>
                        {ratedDimensions.map((dimension) => (
                          <Flexbox
                            horizontal
                            align={'center'}
                            className={stylex.props(styles.row).className}
                            justify={'space-between'}
                            key={dimension.key}
                          >
                            <span>{dimension.label}</span>
                            <Tooltip title={dimension.tooltip}>
                              {dimension.sourceUrl ? (
                                <a
                                  {...stylex.props(styles.ratingScoreLink)}
                                  href={dimension.sourceUrl}
                                  rel={'noreferrer'}
                                  target={'_blank'}
                                >
                                  {dimension.score}
                                </a>
                              ) : (
                                <span {...stylex.props(styles.ratingScoreLink)}>
                                  {dimension.score}
                                </span>
                              )}
                            </Tooltip>
                          </Flexbox>
                        ))}
                      </Flexbox>
                    )}
                  </Flexbox>
                </AccordionPanel>
              </AccordionItem>
            )}

            {/* Context Length */}
            {contextWindowLabel && (
              <AccordionItem disabled value="context">
                <AccordionHeader style={{ paddingBlock: 6, paddingInline: 8 }}>
                  <Flexbox horizontal align={'center'} flex={1} gap={8}>
                    <div
                      style={{
                        background: '#1677ff',
                        borderRadius: 2,
                        flexShrink: 0,
                        height: 14,
                        width: 3,
                      }}
                    />
                    <span {...stylex.props(styles.titleText)}>
                      {t('ModelSwitchPanel.detail.context')}
                    </span>
                  </Flexbox>
                  <span {...stylex.props(styles.actionText)}>{contextWindowLabel}</span>
                </AccordionHeader>
              </AccordionItem>
            )}

            {/* Abilities */}
            {hasAbilities && (
              <AccordionItem value="abilities">
                <AccordionHeader>
                  <AccordionTrigger style={{ paddingBlock: 6, paddingInline: 8 }}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <div
                        style={{
                          background: '#722ed1',
                          borderRadius: 2,
                          flexShrink: 0,
                          height: 14,
                          width: 3,
                        }}
                      />
                      <span {...stylex.props(styles.titleText)}>
                        {t('ModelSwitchPanel.detail.abilities')}
                      </span>
                    </Flexbox>
                  </AccordionTrigger>
                  {!isAbilitiesExpanded && (
                    <Flexbox horizontal gap={2}>
                      {enabledAbilities.map((ability) => (
                        <Tag
                          color={ability.color}
                          key={ability.key}
                          style={{ borderRadius: 4, minWidth: 0, padding: '0 4px' }}
                        >
                          <Icon icon={ability.icon} style={{ fontSize: 12 }} />
                        </Tag>
                      ))}
                    </Flexbox>
                  )}
                </AccordionHeader>
                <AccordionPanel>
                  <Flexbox gap={4}>
                    {enabledAbilities.map((ability) => (
                      <Flexbox
                        horizontal
                        align={'center'}
                        className={stylex.props(styles.row).className}
                        justify={'space-between'}
                        key={ability.key}
                      >
                        <Flexbox horizontal align={'center'} gap={6}>
                          <Icon icon={ability.icon} style={{ fontSize: 12 }} />
                          <span>
                            {t(`ModelSwitchPanel.detail.abilities.${ability.key}` as any)}
                          </span>
                        </Flexbox>
                        <span style={{ color: 'var(--lobe-color-text-tertiary)', fontSize: 11 }}>
                          {t(
                            `ModelSelect.featureTag.${ability.key === 'files' ? 'file' : ability.key}` as any,
                          )}
                        </span>
                      </Flexbox>
                    ))}
                  </Flexbox>
                </AccordionPanel>
              </AccordionItem>
            )}

            {/* Pricing */}
            {hasPricing && (formatPrice || approximatePriceLabel) && (
              <AccordionItem value="pricing">
                <AccordionHeader>
                  <AccordionTrigger style={{ paddingBlock: 6, paddingInline: 8 }}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <div
                        style={{
                          background: '#fa8c16',
                          borderRadius: 2,
                          flexShrink: 0,
                          height: 14,
                          width: 3,
                        }}
                      />
                      <span {...stylex.props(styles.titleText)}>
                        {t('ModelSwitchPanel.detail.pricing')}
                      </span>
                    </Flexbox>
                  </AccordionTrigger>
                  {!isPricingExpanded &&
                    (approximatePriceLabel ? (
                      <span {...stylex.props(styles.actionText)}>{approximatePriceLabel}</span>
                    ) : (
                      <Flexbox
                        horizontal
                        align={'center'}
                        className={stylex.props(styles.actionText).className}
                        gap={8}
                      >
                        {hasCachedInputPricing && (
                          <Tooltip
                            title={getPricingTooltip(
                              'cachedInput',
                              formatPrice!.cachedInput.current,
                            )}
                          >
                            <Flexbox horizontal align={'center'} gap={2}>
                              <Icon icon={CircleFadingArrowUp} size={'small'} />
                              <PriceValue price={formatPrice!.cachedInput} />
                            </Flexbox>
                          </Tooltip>
                        )}
                        <Tooltip title={getPricingTooltip('input', formatPrice!.input.current)}>
                          <Flexbox horizontal align={'center'} gap={2}>
                            <Icon icon={ArrowUpFromDot} size={'small'} />
                            <PriceValue price={formatPrice!.input} />
                          </Flexbox>
                        </Tooltip>
                        <Tooltip title={getPricingTooltip('output', formatPrice!.output.current)}>
                          <Flexbox horizontal align={'center'} gap={2}>
                            <Icon icon={ArrowDownToDot} size={'small'} />
                            <PriceValue price={formatPrice!.output} />
                          </Flexbox>
                        </Tooltip>
                      </Flexbox>
                    ))}
                </AccordionHeader>
                <AccordionPanel>
                  <Flexbox gap={8}>
                    {approximatePriceLabel && (
                      <Flexbox
                        className={stylex.props(styles.row).className}
                        style={{ fontWeight: 500 }}
                      >
                        {approximatePriceLabel}
                      </Flexbox>
                    )}
                    {pricingGroups.map(({ group, units }) => (
                      <Flexbox gap={4} key={group}>
                        {pricingGroups.length > 1 && (
                          <Flexbox
                            className={stylex.props(styles.row).className}
                            style={{ fontWeight: 500 }}
                          >
                            {t(`ModelSwitchPanel.detail.pricing.group.${group}` as any)}
                          </Flexbox>
                        )}
                        {units.map((unit) => (
                          <Flexbox
                            horizontal
                            align={'center'}
                            className={stylex.props(styles.row).className}
                            justify={'space-between'}
                            key={unit.name}
                          >
                            <Flexbox horizontal align={'center'} gap={6}>
                              {UNIT_ICON_MAP[unit.name] && (
                                <Icon icon={UNIT_ICON_MAP[unit.name]!} size={'small'} />
                              )}
                              <span>
                                {t(`ModelSwitchPanel.detail.pricing.unit.${unit.name}` as any)}
                              </span>
                            </Flexbox>
                            <PriceValue
                              prefix={isCreditPricing ? '' : '$'}
                              price={formatUnitPrice(unit)}
                              suffix={getUnitPriceSuffix(unit.unit)}
                            />
                          </Flexbox>
                        ))}
                      </Flexbox>
                    ))}
                  </Flexbox>
                </AccordionPanel>
              </AccordionItem>
            )}
          </AccordionRoot>
        )}
      </Flexbox>
    );
  },
);

ModelDetailPanel.displayName = 'ModelDetailPanel';

export default ModelDetailPanel;
