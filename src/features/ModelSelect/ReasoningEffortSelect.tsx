'use client';

import { Tooltip } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useReasoningEffortControl } from '@/features/ChatInput/hooks/useReasoningEffortControl';
import { useAiInfraStore } from '@/store/aiInfra';

interface ReasoningEffortSelectProps {
  disabled?: boolean;
  model: string;
  provider: string;
}

/**
 * Default reasoning effort / mode for the agent's model, shown next to the
 * model picker on the Agent Profile page.
 *
 * Deliberately NOT an agent-level setting: the value is the user's per-model
 * default (`useReasoningEffortControl` without a topic), the same one the chat
 * input edits for a new conversation and that every new topic snapshots. The
 * profile page is simply the natural place to see "what effort will a new
 * topic with this agent start at", so the hint spells out the shared scope.
 */
const ReasoningEffortSelect = memo<ReasoningEffortSelectProps>(({ disabled, model, provider }) => {
  const { t } = useTranslation(['setting', 'chat']);
  // The chat input warms this config through ReasoningConfigLoader; the
  // profile page has no ChatInputProvider, so fetch it here.
  const useFetchAiModelReasoningConfig = useAiInfraStore((s) => s.useFetchAiModelReasoningConfig);
  useFetchAiModelReasoningConfig(model, provider);

  const {
    effortKey,
    effortLevels,
    effortValue,
    hasReasoningMode,
    hasReasoningParams,
    modeLevels,
    modeValue,
    select,
    updating,
  } = useReasoningEffortControl(model, provider);

  if (!hasReasoningParams) return null;

  return (
    <Tooltip title={t('settingAgent.runtimeConfig.reasoningEffortHint', { ns: 'setting' })}>
      <div style={{ display: 'flex', gap: 8 }}>
        {effortKey && (
          <Select
            disabled={disabled || updating}
            placeholder={t('reasoningEffort.title', { ns: 'chat' })}
            popupMatchSelectWidth={false}
            value={effortValue}
            options={effortLevels.map((level) => ({
              label: t(`reasoningEffort.levels.${level}`, { ns: 'chat' }),
              value: level,
            }))}
            onChange={(value) => {
              if (typeof value === 'string') select({ [effortKey]: value });
            }}
          />
        )}
        {hasReasoningMode && (
          <Select
            disabled={disabled || updating}
            popupMatchSelectWidth={false}
            value={modeValue}
            options={modeLevels.map((mode) => ({
              label: t(`reasoningEffort.mode.${mode}`, { ns: 'chat' }),
              value: mode,
            }))}
            onChange={(value) => {
              if (typeof value === 'string') select({ reasoningMode: value as typeof modeValue });
            }}
          />
        )}
      </div>
    </Tooltip>
  );
});

ReasoningEffortSelect.displayName = 'ReasoningEffortSelect';

export default ReasoningEffortSelect;
