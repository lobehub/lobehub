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

import { getEffortLabelKeys, getModeLabelKey, getModelLabel, getTriggerText } from './labels';
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
  key: 'mode' | 'model' | 'reasoning' | 'speed';
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
  | { capability: HeteroSelectorCapability; kind: 'menu' }
  | { capability: ModelCapability; kind: 'catalog' }
  | { kind: 'none' };

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
  if (!provider || !enabled || !capability || Object.keys(capability).length === 0) {
    return { kind: 'none' };
  }

  const hasOtherDimensions = !!capability.effort || !!capability.mode || !!capability.speed;

  if (capability.model?.source === 'catalog' && !hasOtherDimensions) {
    return { capability: { ...capability, model: capability.model }, kind: 'catalog' };
  }

  return { capability, kind: 'menu' };
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
  capability: HeteroSelectorCapability;
  provider: HeterogeneousProviderConfig;
  t: Translate;
}): SelectorView => {
  const model = capability.model?.resolve(provider) ?? HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const effort = capability.effort?.resolve(provider);
  const mode = capability.mode?.resolve(provider);
  const speedSupported = capability.speed?.supported(model) ?? false;
  const speed: HeterogeneousSpeedMode = speedSupported
    ? capability.speed!.resolve(provider)
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const isFastSpeed = speed === 'fast';

  const defaultLabel = t('heteroAgent.modelSelector.default');
  const modelLabel = getModelLabel(model, defaultLabel);
  const effortLabelKeys = getEffortLabelKeys(provider.type);
  const effortLabel = effort ? t(effortLabelKeys[effort]) : undefined;
  const modeLabel = mode ? t(getModeLabelKey(mode)) : undefined;
  const isCatalogModel = capability.model?.source === 'catalog';
  const isModeOnly =
    !!capability.mode && !capability.model && !capability.effort && !capability.speed;

  const dimensions: SelectorDimension[] = [];

  if (capability.model && !isCatalogModel) {
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

  if (capability.mode && mode) {
    dimensions.push({
      current: mode,
      key: 'mode',
      label: t('heteroAgent.modelSelector.mode.label'),
      options: [
        { label: defaultLabel, value: HETEROGENEOUS_AGENT_DEFAULT_SELECTION },
        ...capability.mode.levels.map((level) => ({
          label: t(getModeLabelKey(level)),
          value: level,
        })),
      ],
      valueLabel: modeLabel ?? defaultLabel,
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
    ariaLabel: isModeOnly
      ? t('heteroAgent.modelSelector.mode.ariaLabel', { mode: modeLabel ?? defaultLabel })
      : t('heteroAgent.modelSelector.ariaLabel', {
          model: modelLabel,
          reasoning: effortLabel ?? defaultLabel,
        }),
    dimensions,
    isCatalogModel,
    isFastSpeed,
    model,
    triggerText: isModeOnly
      ? mode === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
        ? t('heteroAgent.modelSelector.defaultConfig')
        : (modeLabel ?? defaultLabel)
      : getTriggerText({
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
