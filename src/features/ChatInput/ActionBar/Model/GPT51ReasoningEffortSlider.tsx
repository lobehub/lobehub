import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const GPT51_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high'] as const;
type GPT51ReasoningEffort = (typeof GPT51_REASONING_EFFORT_LEVELS)[number];

export interface GPT51ReasoningEffortSliderProps {
  defaultValue?: GPT51ReasoningEffort;
  onChange?: (value: GPT51ReasoningEffort) => void;
  value?: GPT51ReasoningEffort;
}

const GPT51ReasoningEffortSlider = memo<GPT51ReasoningEffortSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'none' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.gpt5_1ReasoningEffort as GPT51ReasoningEffort) || defaultValue;

    const handleChange = useCallback(
      (effort: GPT51ReasoningEffort) => {
        if (isControlled) {
          controlledOnChange?.(effort);
        } else {
          updateAgentChatConfig({ gpt5_1ReasoningEffort: effort });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<GPT51ReasoningEffort>
        defaultValue={defaultValue}
        levels={GPT51_REASONING_EFFORT_LEVELS}
        minWidth={200}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default GPT51ReasoningEffortSlider;
