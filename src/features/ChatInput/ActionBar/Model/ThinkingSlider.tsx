import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const THINKING_MODES = ['disabled', 'auto', 'enabled'] as const;
type ThinkingMode = (typeof THINKING_MODES)[number];

// Display marks for the slider
const THINKING_MARKS = {
  0: 'OFF',
  1: 'Auto',
  2: 'ON',
};

export interface ThinkingSliderProps {
  defaultValue?: ThinkingMode;
  onChange?: (value: ThinkingMode) => void;
  value?: ThinkingMode;
}

const ThinkingSlider = memo<ThinkingSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'auto' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.thinking as ThinkingMode) || defaultValue;

    const handleChange = useCallback(
      (mode: ThinkingMode) => {
        if (isControlled) {
          controlledOnChange?.(mode);
        } else {
          updateAgentChatConfig({ thinking: mode });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<ThinkingMode>
        defaultValue={defaultValue}
        levels={THINKING_MODES}
        marks={THINKING_MARKS}
        minWidth={200}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default ThinkingSlider;
