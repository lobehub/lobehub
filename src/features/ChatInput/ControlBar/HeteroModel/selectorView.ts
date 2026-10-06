import type {
  HeterogeneousProviderConfig,
  HeterogeneousReasoningEffort,
  HeterogeneousSpeedMode,
  HeterogeneousTopicPin,
  HeteroSelection,
  HeteroSelectorCapability,
} from '@lobechat/types';
import {
  getHeteroSelectorCapability,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
} from '@lobechat/types';
import type { TFunction } from 'i18next';

import type { TriggerLabel } from './labels';
import { getEffortLabelKeys, getModeLabelKey, getModelLabel, getTriggerLabel } from './labels';
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
  /** Where the current value comes from: the Agent default or this topic. */
  source: string;
  valueLabel: string;
}

export interface SelectorView {
  ariaLabel: string;
  dimensions: SelectorDimension[];
  isCatalogModel: boolean;
  isFastSpeed: boolean;
  model: string;
  /** Where the current model comes from; shown on the catalog model submenu too. */
  modelSource: string;
  triggerLabel: TriggerLabel;
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
  topicPin,
  topicScoped = false,
}: {
  capability: HeteroSelectorCapability;
  /** The effective config, with any topic pins already applied. */
  provider: HeterogeneousProviderConfig;
  t: Translate;
  /** The active topic's raw pins, used only to label each value's source. */
  topicPin?: HeterogeneousTopicPin;
  /** Whether a topic is active, so picks write to it instead of the Agent. */
  topicScoped?: boolean;
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

  const agentSource = t('heteroAgent.modelSelector.source.agent');
  const getSource = (pinned: boolean) => {
    if (!topicScoped) return agentSource;
    return t(
      pinned
        ? 'heteroAgent.modelSelector.source.topic'
        : 'heteroAgent.modelSelector.source.inherited',
    );
  };

  // A pin from another runtime or auth mode is ignored, so it is not the source.
  const modelSource = getSource(topicPin?.model !== undefined && topicPin.model === model);

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
      source: modelSource,
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
      source: agentSource,
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
      source: getSource(topicPin?.effort !== undefined),
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
      source: getSource(topicPin?.speed !== undefined),
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
    modelSource,
    triggerLabel: isModeOnly
      ? {
          text:
            mode === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
              ? t('heteroAgent.modelSelector.defaultConfig')
              : (modeLabel ?? defaultLabel),
        }
      : getTriggerLabel({
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
