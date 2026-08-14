import { Icon } from '@lobehub/ui';
import { css, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CheckIcon, ChevronRight, GaugeIcon } from 'lucide-react';
import type { AiModelReasoningConfig } from 'model-bank';
import { MODEL_REASONING_PARAM_DEFAULTS, MODEL_REASONING_PARAM_LEVELS } from 'model-bank';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';

const activeLabel = css`
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;

  width: 100%;

  color: inherit;
`;

const currentValue = css`
  overflow: hidden;

  font-size: 12px;
  color: ${cssVar.colorTextSecondary};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/**
 * "Reasoning intensity" submenu for the "+" menu. The value is a user-level
 * model-instance setting (userId + providerId + modelId, personal scope) — not
 * agent resource configuration — so it must stay visible regardless of
 * `canConfigureResource`. Returns no items unless the effective model declares
 * a reasoning-effort family extend param (or reasoningMode).
 *
 * The saved model-instance defaults are fetched by ReasoningConfigLoader
 * (mounted in ChatInputProvider), so this submenu and the send pipeline
 * (modelParamsResolver) read the same store value.
 */
export const useEffortMenuItem = (): ActionDropdownMenuItems => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);

  const hasReasoningParams = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningExtendParams(model, provider),
  );
  const reasoningParams = useAiInfraStore(
    aiModelSelectors.modelReasoningExtendParams(model, provider),
    isEqual,
  );
  const config = useAiInfraStore(aiModelSelectors.modelReasoningConfig(model, provider), isEqual);
  const updating = useAiInfraStore(
    aiModelSelectors.isModelReasoningConfigUpdating(model, provider),
  );
  const updateModelReasoningConfig = useAiInfraStore((s) => s.updateModelReasoningConfig);

  return useMemo<ActionDropdownMenuItems>(() => {
    if (!hasReasoningParams) return [];

    // modelReasoningExtendParams only returns MODEL_REASONING_EXTEND_PARAMS
    // entries, so the narrowing cast is safe
    const effortKey = reasoningParams.find((param) => param !== 'reasoningMode') as
      Exclude<keyof AiModelReasoningConfig, 'reasoningMode'> | undefined;
    const hasReasoningMode = reasoningParams.includes('reasoningMode');

    // Keep the same model-dependent fallback as the ControlsForm slider
    const effortDefault = effortKey
      ? effortKey === 'gpt5_2ReasoningEffort' && model === 'gpt-5.5'
        ? 'medium'
        : MODEL_REASONING_PARAM_DEFAULTS[effortKey]
      : undefined;
    const effortValue = (effortKey && config?.[effortKey]) ?? effortDefault;
    const modeValue = config?.reasoningMode ?? MODEL_REASONING_PARAM_DEFAULTS.reasoningMode;

    const handleSelect = async (patch: AiModelReasoningConfig) => {
      if (updating) return;
      // failure already rolls back and toasts inside the store action
      await updateModelReasoningConfig(model, provider, patch).catch(() => {});
    };

    const renderActive = (label: ReactNode, active: boolean) =>
      active ? (
        <div className={cx(activeLabel)}>
          <span>{label}</span>
          <Icon icon={CheckIcon} size={14} />
        </div>
      ) : (
        label
      );

    const effortChildren: ActionDropdownMenuItems = effortKey
      ? MODEL_REASONING_PARAM_LEVELS[effortKey].map((level) => ({
          key: `effort-${level}`,
          label: renderActive(t(`reasoningEffort.levels.${level}`), effortValue === level),
          onClick: () => handleSelect({ [effortKey]: level }),
        }))
      : [];

    const modeChildren: ActionDropdownMenuItems = hasReasoningMode
      ? MODEL_REASONING_PARAM_LEVELS.reasoningMode.map((mode) => ({
          key: `effort-mode-${mode}`,
          label: renderActive(t(`reasoningEffort.mode.${mode}`), modeValue === mode),
          onClick: () => handleSelect({ reasoningMode: mode }),
        }))
      : [];

    // When the model exposes both params, wrap each list in a labeled group so
    // users can tell "effort level" and "reasoning mode" are two independent
    // settings (each carries its own check mark). A single-param submenu stays
    // flat — the parent row already names it.
    const children: ActionDropdownMenuItems =
      effortChildren.length > 0 && modeChildren.length > 0
        ? [
            {
              children: effortChildren,
              key: 'effort-level-group',
              label: t('reasoningEffort.title'),
              type: 'group' as const,
            },
            { type: 'divider' as const },
            {
              children: modeChildren,
              key: 'effort-mode-group',
              label: t('extendParams.reasoningMode.title'),
              type: 'group' as const,
            },
          ]
        : [...effortChildren, ...modeChildren];

    // Current value shown on the collapsed row (Codex-style): effort level,
    // plus the reasoning mode when the model exposes both.
    const currentText = [
      effortKey && effortValue ? t(`reasoningEffort.levels.${effortValue}`) : undefined,
      hasReasoningMode ? t(`reasoningEffort.mode.${modeValue}`) : undefined,
    ]
      .filter(Boolean)
      .join(' · ');

    return [
      {
        children,
        // Trailing chevron (replaces base-ui's default triangle submenu arrow,
        // which is hidden via the .lobe-submenu-chevron rule in ActionDropdown).
        extra: <Icon className="lobe-submenu-chevron" icon={ChevronRight} size={16} />,
        icon: GaugeIcon,
        key: 'effort',
        label: (
          <div className={cx(activeLabel)}>
            <span>{t('reasoningEffort.title')}</span>
            {currentText && <span className={cx(currentValue)}>{currentText}</span>}
          </div>
        ),
      } as ActionDropdownMenuItems[number],
    ];
  }, [
    config,
    hasReasoningParams,
    model,
    provider,
    reasoningParams,
    t,
    updateModelReasoningConfig,
    updating,
  ]);
};
