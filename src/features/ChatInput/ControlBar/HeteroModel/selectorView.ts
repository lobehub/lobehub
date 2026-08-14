import type {
  HeterogeneousProviderConfig,
  HeterogeneousReasoningEffort,
  HeterogeneousSpeedMode,
  HeteroSelection,
  HeteroSelectorCapability,
} from '@lobechat/types';
import {
  getHeteroSelectorCapability,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
} from '@lobechat/types';
import type { TFunction } from 'i18next';

import { getEffortLabelKeys, getModelLabel, getTriggerText } from './labels';
import { getStaticModelOptions } from './modelOptions';

type Translate = TFunction<'chat'>;

export type ModelCapability = Required<Pick<HeteroSelectorCapability, 'model'>> &
  HeteroSelectorCapability;

export interface SelectorDimensionOption {
  desc?: string;
  label: string;
  value: string;
}

export interface SelectorDimension {
  current: string;
  key: 'model' | 'reasoning' | 'speed';
  label: string;
  options: SelectorDimensionOption[];
  valueLabel: string;
}

export interface SelectorView {
  ariaLabel: string;
  dimensions: SelectorDimension[];
  isCatalogModel: boolean;
  isFastSpeed: boolean;
  model: string;
  triggerText: string;
}

export type SelectorShape =
  { capability: ModelCapability; kind: 'catalog' | 'menu' } | { kind: 'none' };

/**
 * Which of the three selector presentations a provider gets: nothing, the bare
 * catalog picker, or the multi-dimension menu. A catalog provider with no other
 * dimension has nothing to wrap, so it renders its picker directly.
 */
export const resolveSelectorShape = (
  provider: HeterogeneousProviderConfig | undefined,
  enabled: boolean,
): SelectorShape => {
  const capability = getHeteroSelectorCapability(provider?.type);
  if (!provider || !enabled || !capability?.model) return { kind: 'none' };

  const modelCapability = { ...capability, model: capability.model };
  const hasOtherDimensions = !!capability.effort || !!capability.speed;

  return {
    capability: modelCapability,
    kind: capability.model.source === 'catalog' && !hasOtherDimensions ? 'catalog' : 'menu',
  };
};

/**
 * A dimension the newly picked model cannot serve would otherwise stay persisted
 * and be silently dropped by the CLI, leaving the menu claiming a setting the
 * run never used.
 */
export const resolveModelSwitchSelection = ({
  capability,
  effort,
  isFastSpeed,
  value,
}: {
  capability: ModelCapability;
  effort?: HeterogeneousReasoningEffort;
  isFastSpeed: boolean;
  value: string;
}): HeteroSelection => {
  const resetSpeed = isFastSpeed && !!capability.speed && !capability.speed.supported(value);
  const resetEffort =
    !!effort &&
    effort !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
    !!capability.effort &&
    !capability.effort.levels(value).includes(effort);

  return {
    ...(resetEffort ? { effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION } : {}),
    model: value,
    ...(resetSpeed ? { speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION } : {}),
  };
};

export const buildSelectorView = ({
  capability,
  provider,
  t,
}: {
  capability: ModelCapability;
  provider: HeterogeneousProviderConfig;
  t: Translate;
}): SelectorView => {
  const model = capability.model.resolve(provider);
  const effort = capability.effort?.resolve(provider);
  const speedSupported = capability.speed?.supported(model) ?? false;
  const speed: HeterogeneousSpeedMode = speedSupported
    ? capability.speed!.resolve(provider)
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const isFastSpeed = speed === 'fast';

  const defaultLabel = t('heteroAgent.modelSelector.default');
  const modelLabel = getModelLabel(model, defaultLabel);
  const effortLabelKeys = getEffortLabelKeys(provider.type);
  const effortLabel = effort ? t(effortLabelKeys[effort]) : undefined;
  const isCatalogModel = capability.model.source === 'catalog';

  const dimensions: SelectorDimension[] = [];

  if (!isCatalogModel) {
    const baseOptions: SelectorDimensionOption[] = [
      { label: defaultLabel, value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
      ...getStaticModelOptions(provider.type),
    ];

    dimensions.push({
      current: model,
      key: 'model',
      label: t('heteroAgent.modelSelector.model'),
      options: baseOptions.some((option) => option.value === model)
        ? baseOptions
        : [{ label: model, value: model }, ...baseOptions],
      valueLabel: modelLabel,
    });
  }

  if (capability.effort && effort) {
    dimensions.push({
      current: effort,
      key: 'reasoning',
      label: t('heteroAgent.modelSelector.reasoning'),
      options: [
        { label: defaultLabel, value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
        ...capability.effort.levels(model).map((level) => ({
          label: t(effortLabelKeys[level]),
          value: level,
        })),
      ],
      valueLabel: effortLabel!,
    });
  }

  if (speedSupported) {
    dimensions.push({
      current: speed,
      key: 'speed',
      label: t('heteroAgent.modelSelector.speed'),
      options: [
        {
          desc: t('heteroAgent.modelSelector.speed.standardDesc'),
          label: t('heteroAgent.modelSelector.speed.standard'),
          value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        },
        {
          desc: t('heteroAgent.modelSelector.speed.fastDesc'),
          label: t('heteroAgent.modelSelector.speed.fast'),
          value: 'fast',
        },
      ],
      valueLabel: t(
        isFastSpeed
          ? 'heteroAgent.modelSelector.speed.fast'
          : 'heteroAgent.modelSelector.speed.standard',
      ),
    });
  }

  return {
    ariaLabel: t('heteroAgent.modelSelector.ariaLabel', {
      model: modelLabel,
      reasoning: effortLabel ?? defaultLabel,
    }),
    dimensions,
    isCatalogModel,
    isFastSpeed,
    model,
    triggerText: getTriggerText({
      defaultConfigLabel: t('heteroAgent.modelSelector.defaultConfig'),
      defaultModelLabel: t('heteroAgent.modelSelector.defaultModel'),
      defaultReasoningLabel: t('heteroAgent.modelSelector.defaultReasoning'),
      effort,
      effortLabel,
      model,
      modelLabel,
    }),
  };
};
