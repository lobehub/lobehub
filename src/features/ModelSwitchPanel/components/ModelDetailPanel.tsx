import { getCachedTextInputUnitRate } from '@lobechat/utils';
import { ModelIcon } from '@lobehub/icons';
import { Accordion, AccordionItem, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  AtomIcon,
  CircleFadingArrowUp,
  EyeIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
  VideoIcon,
  WrenchIcon,
} from 'lucide-react';
import {
  type AiModelForSelect,
  type FixedPricingUnit,
  type ModelPriceCurrency,
  type Pricing,
  type PricingUnit,
  type PricingUnitName,
  type TieredPricingUnit,
} from 'model-bank';
import { type FC, type ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTokenNumber } from '@/utils/format';
import { formatPriceByCurrency, getTextInputUnitRate, getTextOutputUnitRate } from '@/utils/index';

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
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding-block: 4px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  titleText: css`
    font-size: 14px;
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const getPrice = (pricing: Pricing) => {
  const inputRate = getTextInputUnitRate(pricing);
  const outputRate = getTextOutputUnitRate(pricing);
  const cachedInputRate = getCachedTextInputUnitRate(pricing);

  return {
    cachedInput: cachedInputRate
      ? formatPriceByCurrency(cachedInputRate, pricing?.currency as ModelPriceCurrency)
      : '0',
    input: inputRate
      ? formatPriceByCurrency(inputRate, pricing?.currency as ModelPriceCurrency)
      : '0',
    output: outputRate
      ? formatPriceByCurrency(outputRate, pricing?.currency as ModelPriceCurrency)
      : '0',
  };
};

// --- Pricing detail helpers ---

type PricingGroup = 'audio' | 'image' | 'text' | 'video';

const UNIT_GROUP_MAP: Record<PricingUnitName, PricingGroup> = {
  audioInput: 'audio',
  audioInput_cacheRead: 'audio',
  audioOutput: 'audio',
  imageGeneration: 'image',
  imageInput: 'image',
  imageInput_cacheRead: 'image',
  imageOutput: 'image',
  textInput: 'text',
  textInput_cacheRead: 'text',
  textInput_cacheWrite: 'text',
  textOutput: 'text',
  videoGeneration: 'video',
};

const GROUP_ORDER: PricingGroup[] = ['text', 'image', 'audio', 'video'];

const UNIT_ICON_MAP: Partial<Record<PricingUnitName, LucideIcon>> = {
  audioInput: ArrowUpFromDot,
  audioInput_cacheRead: CircleFadingArrowUp,
  audioOutput: ArrowDownToDot,
  imageGeneration: ImageIcon,
  imageInput: ArrowUpFromDot,
  imageInput_cacheRead: CircleFadingArrowUp,
  imageOutput: ArrowDownToDot,
  textInput: ArrowUpFromDot,
  textInput_cacheRead: CircleFadingArrowUp,
  textInput_cacheWrite: CircleFadingArrowUp,
  textOutput: ArrowDownToDot,
};

const UNIT_SORT_ORDER: Record<PricingUnitName, number> = {
  textInput: 0,
  textOutput: 1,
  textInput_cacheRead: 2,
  textInput_cacheWrite: 3,
  imageInput: 0,
  imageOutput: 1,
  imageInput_cacheRead: 2,
  imageGeneration: 3,
  audioInput: 0,
  audioOutput: 1,
  audioInput_cacheRead: 2,
  videoGeneration: 0,
};

const UNIT_LABEL_MAP: Record<string, string> = {
  image: '/img',
  megapixel: '/MP',
  millionCharacters: '/M chars',
  millionTokens: '/M tokens',
  second: '/s',
};

const formatUnitRate = (unit: PricingUnit, currency?: ModelPriceCurrency): string => {
  const unitLabel = UNIT_LABEL_MAP[unit.unit] || '';

  if (unit.strategy === 'fixed') {
    const price = formatPriceByCurrency((unit as FixedPricingUnit).rate, currency);
    return `$${price}${unitLabel}`;
  }

  if (unit.strategy === 'tiered') {
    const tiers = (unit as TieredPricingUnit).tiers;
    if (tiers.length === 1) {
      const price = formatPriceByCurrency(tiers[0].rate, currency);
      return `$${price}${unitLabel}`;
    }
    const low = formatPriceByCurrency(tiers[0].rate, currency);
    const high = formatPriceByCurrency(tiers.at(-1)!.rate, currency);
    return `$${low} ~ $${high}${unitLabel}`;
  }

  // lookup strategy
  if (unit.strategy === 'lookup') {
    const prices = Object.values(unit.lookup.prices);
    if (prices.length === 1) {
      const price = formatPriceByCurrency(prices[0], currency);
      return `$${price}${unitLabel}`;
    }
    const sorted = [...prices].sort((a, b) => a - b);
    const low = formatPriceByCurrency(sorted[0], currency);
    const high = formatPriceByCurrency(sorted.at(-1)!, currency);
    return `$${low} ~ $${high}${unitLabel}`;
  }

  return '-';
};

interface PricingGroupData {
  group: PricingGroup;
  units: PricingUnit[];
}

const groupPricingUnits = (units: PricingUnit[]): PricingGroupData[] => {
  const map = new Map<PricingGroup, PricingUnit[]>();
  for (const unit of units) {
    const group = UNIT_GROUP_MAP[unit.name] || 'text';
    const arr = map.get(group) || [];
    arr.push(unit);
    map.set(group, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => (UNIT_SORT_ORDER[a.name] ?? 99) - (UNIT_SORT_ORDER[b.name] ?? 99));
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, units: map.get(g)! }));
};

interface AbilityItem {
  color: string;
  icon: LucideIcon;
  key: string;
}

const ABILITY_CONFIG: AbilityItem[] = [
  { color: 'success', icon: EyeIcon, key: 'vision' },
  { color: 'success', icon: PaperclipIcon, key: 'files' },
  { color: 'success', icon: ImageIcon, key: 'imageOutput' },
  { color: 'magenta', icon: VideoIcon, key: 'video' },
  { color: 'info', icon: WrenchIcon, key: 'functionCall' },
  { color: 'purple', icon: AtomIcon, key: 'reasoning' },
  { color: 'cyan', icon: GlobeIcon, key: 'search' },
];

interface ModelDetailPanelProps {
  extraControls?: ReactNode;
  model: AiModelForSelect;
}

const ModelDetailPanel: FC<ModelDetailPanelProps> = memo(({ extraControls, model }) => {
  const { t } = useTranslation('components');
  const { t: tModels } = useTranslation('models');
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => {
    const keys: string[] = [];
    if (extraControls) keys.push('config');
    return keys;
  });

  const hasPricing = !!model.pricing;
  const formatPrice = hasPricing ? getPrice(model.pricing!) : null;
  const pricingGroups = useMemo(
    () => (hasPricing ? groupPricingUnits(model.pricing!.units) : []),
    [hasPricing, model.pricing],
  );
  const hasContext = typeof model.contextWindowTokens === 'number';
  const enabledAbilities = ABILITY_CONFIG.filter(
    (a) => model.abilities[a.key as keyof typeof model.abilities],
  );
  const hasAbilities = enabledAbilities.length > 0;

  return (
    <Flexbox className={styles.container}>
      {/* Header */}
      <Flexbox gap={8} padding={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ModelIcon model={model.id} size={28} />
          <Text ellipsis style={{ fontSize: 16, fontWeight: 600 }}>
            {model.displayName || model.id}
          </Text>
        </Flexbox>
        {model.description && (
          <div className={styles.description}>{tModels(`${model.id}.description`)}</div>
        )}
      </Flexbox>
      <Divider size="small" />

      {/* Sections */}
      {(hasPricing || hasContext || hasAbilities || extraControls) && (
        <Accordion
          expandedKeys={expandedKeys}
          gap={8}
          onExpandedChange={(keys) => setExpandedKeys(keys as string[])}
        >
          {/* Context Length */}
          {hasContext && (
            <AccordionItem
              alwaysShowAction
              hideIndicator
              allowExpand={false}
              itemKey="context"
              paddingBlock={6}
              paddingInline={8}
              action={
                <span className={styles.actionText}>
                  {model.contextWindowTokens === 0
                    ? '∞'
                    : `${formatTokenNumber(model.contextWindowTokens!)} tokens`}
                </span>
              }
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
                !expandedKeys.includes('abilities') && (
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
                  <span className={styles.titleText}>{t('ModelSwitchPanel.detail.abilities')}</span>
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
          {hasPricing && formatPrice && (
            <AccordionItem
              alwaysShowAction
              itemKey="pricing"
              paddingBlock={6}
              paddingInline={8}
              action={
                !expandedKeys.includes('pricing') && (
                  <Flexbox horizontal align={'center'} className={styles.actionText} gap={8}>
                    {getCachedTextInputUnitRate(model.pricing!) && (
                      <Tooltip
                        title={t('ModelSwitchPanel.detail.pricing.cachedInput', {
                          amount: formatPrice.cachedInput,
                        })}
                      >
                        <Flexbox horizontal align={'center'} gap={2}>
                          <Icon icon={CircleFadingArrowUp} size={'small'} />
                          {formatPrice.cachedInput}
                        </Flexbox>
                      </Tooltip>
                    )}
                    <Tooltip
                      title={t('ModelSwitchPanel.detail.pricing.input', {
                        amount: formatPrice.input,
                      })}
                    >
                      <Flexbox horizontal align={'center'} gap={2}>
                        <Icon icon={ArrowUpFromDot} size={'small'} />
                        {formatPrice.input}
                      </Flexbox>
                    </Tooltip>
                    <Tooltip
                      title={t('ModelSwitchPanel.detail.pricing.output', {
                        amount: formatPrice.output,
                      })}
                    >
                      <Flexbox horizontal align={'center'} gap={2}>
                        <Icon icon={ArrowDownToDot} size={'small'} />
                        {formatPrice.output}
                      </Flexbox>
                    </Tooltip>
                  </Flexbox>
                )
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
                        <span>
                          {formatUnitRate(unit, model.pricing?.currency as ModelPriceCurrency)}
                        </span>
                      </Flexbox>
                    ))}
                  </Flexbox>
                ))}
              </Flexbox>
            </AccordionItem>
          )}
          {/* Model Config */}
          {extraControls && (
            <AccordionItem
              itemKey="config"
              paddingBlock={6}
              paddingInline={8}
              title={
                <Flexbox horizontal align={'center'} gap={8}>
                  <div
                    style={{
                      background: '#52c41a',
                      borderRadius: 2,
                      flexShrink: 0,
                      height: 14,
                      width: 3,
                    }}
                  />
                  <span className={styles.titleText}>{t('ModelSwitchPanel.detail.config')}</span>
                </Flexbox>
              }
            >
              {extraControls}
            </AccordionItem>
          )}
        </Accordion>
      )}
    </Flexbox>
  );
});

ModelDetailPanel.displayName = 'ModelDetailPanel';

export default ModelDetailPanel;
