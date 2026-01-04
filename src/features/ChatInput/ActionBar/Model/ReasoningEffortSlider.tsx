import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const REASONING_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export interface ReasoningEffortSliderProps {
  defaultValue?: ReasoningEffort;
  onChange?: (value: ReasoningEffort) => void;
  value?: ReasoningEffort;
}

const ReasoningEffortSlider = memo<ReasoningEffortSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'medium' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.reasoningEffort as ReasoningEffort) || defaultValue;

    const handleChange = useCallback(
      (effort: ReasoningEffort) => {
        if (isControlled) {
          controlledOnChange?.(effort);
        } else {
          updateAgentChatConfig({ reasoningEffort: effort });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<ReasoningEffort>
        defaultValue={defaultValue}
        levels={REASONING_EFFORT_LEVELS}
        minWidth={200}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default ReasoningEffortSlider;
