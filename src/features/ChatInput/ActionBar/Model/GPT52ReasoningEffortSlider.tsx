import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const GPT52_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
type GPT52ReasoningEffort = (typeof GPT52_REASONING_EFFORT_LEVELS)[number];

export interface GPT52ReasoningEffortSliderProps {
  defaultValue?: GPT52ReasoningEffort;
  onChange?: (value: GPT52ReasoningEffort) => void;
  value?: GPT52ReasoningEffort;
}

const GPT52ReasoningEffortSlider = memo<GPT52ReasoningEffortSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'none' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.gpt5_2ReasoningEffort as GPT52ReasoningEffort) || defaultValue;

    const handleChange = useCallback(
      (effort: GPT52ReasoningEffort) => {
        if (isControlled) {
          controlledOnChange?.(effort);
        } else {
          updateAgentChatConfig({ gpt5_2ReasoningEffort: effort });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<GPT52ReasoningEffort>
        defaultValue={defaultValue}
        levels={GPT52_REASONING_EFFORT_LEVELS}
        minWidth={230}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default GPT52ReasoningEffortSlider;
