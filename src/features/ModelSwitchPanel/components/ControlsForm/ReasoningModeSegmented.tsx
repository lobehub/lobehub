import { Segmented } from '@lobehub/ui/base-ui';
import { MODEL_REASONING_PARAM_LEVELS } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

const REASONING_MODES = MODEL_REASONING_PARAM_LEVELS.reasoningMode;
type ReasoningMode = (typeof REASONING_MODES)[number];

export interface ReasoningModeSegmentedProps {
  defaultValue?: ReasoningMode;
  disabled?: boolean;
  id?: string;
  onChange?: (value: ReasoningMode) => void;
  value?: ReasoningMode;
}

const ReasoningModeSegmentedInner = memo<{
  disabled?: boolean;
  id?: string;
  onChange: (value: ReasoningMode) => void;
  value: ReasoningMode;
}>(({ disabled, id, onChange, value }) => {
  const { t } = useTranslation('chat');

  return (
    <Segmented<ReasoningMode>
      block
      disabled={disabled}
      id={id}
      size={'small'}
      style={{ maxWidth: 240 }}
      value={value}
      options={REASONING_MODES.map((mode) => ({
        label: t(`reasoningEffort.mode.${mode}`),
        value: mode,
      }))}
      onChange={onChange}
    />
  );
});

const ReasoningModeSegmentedWithStore = memo<{
  defaultValue: ReasoningMode;
  disabled?: boolean;
  id?: string;
}>(({ defaultValue, disabled, id }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const value = REASONING_MODES.includes(config.reasoningMode as ReasoningMode)
    ? (config.reasoningMode as ReasoningMode)
    : defaultValue;

  return (
    <ReasoningModeSegmentedInner
      disabled={disabled}
      id={id}
      value={value}
      onChange={(reasoningMode) => updateAgentChatConfig({ reasoningMode })}
    />
  );
});

const ReasoningModeSegmented = memo<ReasoningModeSegmentedProps>(
  ({ defaultValue = 'standard', disabled, id, onChange, value }) => {
    const isControlled = value !== undefined || onChange !== undefined;

    if (isControlled) {
      return (
        <ReasoningModeSegmentedInner
          disabled={disabled}
          id={id}
          value={value ?? defaultValue}
          onChange={onChange ?? (() => {})}
        />
      );
    }

    return (
      <ReasoningModeSegmentedWithStore defaultValue={defaultValue} disabled={disabled} id={id} />
    );
  },
);

export default ReasoningModeSegmented;
