import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const GPT52_PRO_REASONING_EFFORT_LEVELS = ['medium', 'high', 'xhigh'] as const;
type GPT52ProReasoningEffort = (typeof GPT52_PRO_REASONING_EFFORT_LEVELS)[number];

export interface GPT52ProReasoningEffortSliderProps {
  defaultValue?: GPT52ProReasoningEffort;
  onChange?: (value: GPT52ProReasoningEffort) => void;
  value?: GPT52ProReasoningEffort;
}

const GPT52ProReasoningEffortSlider = memo<GPT52ProReasoningEffortSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'medium' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.gpt5_2ProReasoningEffort as GPT52ProReasoningEffort) || defaultValue;

    const handleChange = useCallback(
      (effort: GPT52ProReasoningEffort) => {
        if (isControlled) {
          controlledOnChange?.(effort);
        } else {
          updateAgentChatConfig({ gpt5_2ProReasoningEffort: effort });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<GPT52ProReasoningEffort>
        defaultValue={defaultValue}
        levels={GPT52_PRO_REASONING_EFFORT_LEVELS}
        minWidth={160}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default GPT52ProReasoningEffortSlider;
