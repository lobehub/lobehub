import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const GPT5_REASONING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
type GPT5ReasoningEffort = (typeof GPT5_REASONING_EFFORT_LEVELS)[number];

export interface GPT5ReasoningEffortSliderProps {
  defaultValue?: GPT5ReasoningEffort;
  onChange?: (value: GPT5ReasoningEffort) => void;
  value?: GPT5ReasoningEffort;
}

const GPT5ReasoningEffortSlider = memo<GPT5ReasoningEffortSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'medium' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.gpt5ReasoningEffort as GPT5ReasoningEffort) || defaultValue;

    const handleChange = useCallback(
      (effort: GPT5ReasoningEffort) => {
        if (isControlled) {
          controlledOnChange?.(effort);
        } else {
          updateAgentChatConfig({ gpt5ReasoningEffort: effort });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<GPT5ReasoningEffort>
        defaultValue={defaultValue}
        levels={GPT5_REASONING_EFFORT_LEVELS}
        minWidth={200}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default GPT5ReasoningEffortSlider;
