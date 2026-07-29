import { Accordion, AccordionItem, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowDownToDot, ArrowUpFromDot, CircleFadingArrowUp } from 'lucide-react';
import type { FC } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

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

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionText: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  container: css`
    padding-block-end: 8px;
  `,
  description: css`
    margin: 0;
    padding-block: 8px;
    padding-inline: 8px;

    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  radarClickable: css`
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  ratingScoreLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-weight: 600;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  row: css`
    padding-block: 4px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  originalPriceText: css`
    color: ${cssVar.colorTextTertiary};
    text-decoration: line-through;
  `,
  priceValue: css`
    display: inline-flex;
    gap: 4px;
    align-items: baseline;
  `,
  titleText: css`
    font-size: 14px;
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface PriceValueProps {
  prefix?: string;
  price: FormattedUnitPrice;
  suffix?: string;
}

const PriceValue: FC<PriceValueProps> = ({ price, prefix = '', suffix = '' }) => (
  <span className={styles.priceValue}>
    {price.original && (
      <span className={styles.originalPriceText}>
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

    const description = model.description
      ? String(
          t(`${model.id}.description` as any, {
            defaultValue: model.description,
            ns: 'models',
          }),
        ).trim()
      : undefined;

    return (
      <Flexbox className={styles.container}>
        {description && (
          <Text as={'p'} className={styles.description} fontSize={12} type={'secondary'}>
            {description}
          </Text>
        )}
        {/* Sections */}
        {(hasRating || hasPricing || contextWindowLabel || hasAbilities) && (
          <Accordion expandedKeys={expandedKeys} gap={8} onExpandedChange={handleExpandedChange}>
            {/* Benchmarks */}
            {hasRating && (
              <AccordionItem
                itemKey="rating"
                paddingBlock={6}
                paddingInline={8}
                title={
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
                    <span className={styles.titleText}>{t('ModelSwitchPanel.detail.rating')}</span>
                  </Flexbox>
                }
              >
                <Flexbox gap={4}>
                  {ratedDimensions.length >= RADAR_MIN_DIMENSIONS ? (
                    <Tooltip title={t('ModelSwitchPanel.detail.rating.clickHint')}>
                      <div
                        className={styles.radarClickable}
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
                          className={styles.row}
                          justify={'space-between'}
                          key={dimension.key}
                        >
                          <span>{dimension.label}</span>
                          <Tooltip title={dimension.tooltip}>
                            {dimension.sourceUrl ? (
                              <a
                                className={styles.ratingScoreLink}
                                href={dimension.sourceUrl}
                                rel={'noreferrer'}
                                target={'_blank'}
                              >
                                {dimension.score}
                              </a>
                            ) : (
                              <span className={styles.ratingScoreLink}>{dimension.score}</span>
                            )}
                          </Tooltip>
                        </Flexbox>
                      ))}
                    </Flexbox>
                  )}
                </Flexbox>
              </AccordionItem>
            )}

            {/* Context Length */}
            {contextWindowLabel && (
              <AccordionItem
                alwaysShowAction
                hideIndicator
                action={<span className={styles.actionText}>{contextWindowLabel}</span>}
                allowExpand={false}
                itemKey="context"
                paddingBlock={6}
                paddingInline={8}
                title={
                  <Flexbox horizontal align={'center'} gap={8}>
                    <div
                      style={{
                        background: '#1677ff',
                        borderRadius: 2,
                        flexShrink: 0,
                        height: 14,
                        width: 3,
                      }}
                    />
                    <span className={styles.titleText}>{t('ModelSwitchPanel.detail.context')}</span>
                  </Flexbox>
                }
              />
            )}

            {/* Abilities */}
            {hasAbilities && (
              <AccordionItem
                alwaysShowAction
                itemKey="abilities"
                paddingBlock={6}
                paddingInline={8}
                action={
                  !isAbilitiesExpanded && (
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
                  )
                }
                title={
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
                    <span className={styles.titleText}>
                      {t('ModelSwitchPanel.detail.abilities')}
                    </span>
                  </Flexbox>
                }
              >
                <Flexbox gap={4}>
                  {enabledAbilities.map((ability) => (
                    <Flexbox
                      horizontal
                      align={'center'}
                      className={styles.row}
                      justify={'space-between'}
                      key={ability.key}
                    >
                      <Flexbox horizontal align={'center'} gap={6}>
                        <Icon icon={ability.icon} style={{ fontSize: 12 }} />
                        <span>{t(`ModelSwitchPanel.detail.abilities.${ability.key}` as any)}</span>
                      </Flexbox>
                      <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 11 }}>
                        {t(
                          `ModelSelect.featureTag.${ability.key === 'files' ? 'file' : ability.key}` as any,
                        )}
                      </span>
                    </Flexbox>
                  ))}
                </Flexbox>
              </AccordionItem>
            )}

            {/* Pricing */}
            {hasPricing && (formatPrice || approximatePriceLabel) && (
              <AccordionItem
                alwaysShowAction
                itemKey="pricing"
                paddingBlock={6}
                paddingInline={8}
                action={
                  !isPricingExpanded &&
                  (approximatePriceLabel ? (
                    <span className={styles.actionText}>{approximatePriceLabel}</span>
                  ) : (
                    <Flexbox horizontal align={'center'} className={styles.actionText} gap={8}>
                      {hasCachedInputPricing && (
                        <Tooltip
                          title={getPricingTooltip('cachedInput', formatPrice!.cachedInput.current)}
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
                  ))
                }
                title={
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
                    <span className={styles.titleText}>{t('ModelSwitchPanel.detail.pricing')}</span>
                  </Flexbox>
                }
              >
                <Flexbox gap={8}>
                  {approximatePriceLabel && (
                    <Flexbox className={styles.row} style={{ fontWeight: 500 }}>
                      {approximatePriceLabel}
                    </Flexbox>
                  )}
                  {pricingGroups.map(({ group, units }) => (
                    <Flexbox gap={4} key={group}>
                      {pricingGroups.length > 1 && (
                        <Flexbox className={styles.row} style={{ fontWeight: 500 }}>
                          {t(`ModelSwitchPanel.detail.pricing.group.${group}` as any)}
                        </Flexbox>
                      )}
                      {units.map((unit) => (
                        <Flexbox
                          horizontal
                          align={'center'}
                          className={styles.row}
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
              </AccordionItem>
            )}
          </Accordion>
        )}
      </Flexbox>
    );
  },
);

ModelDetailPanel.displayName = 'ModelDetailPanel';

export default ModelDetailPanel;
