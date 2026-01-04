import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ThinkingLevelSliderProps {
  defaultValue?: ThinkingLevel;
  onChange?: (value: ThinkingLevel) => void;
  value?: ThinkingLevel;
}

const ThinkingLevelSlider = memo<ThinkingLevelSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'high' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.thinkingLevel as ThinkingLevel) || defaultValue;

    const handleChange = useCallback(
      (level: ThinkingLevel) => {
        if (isControlled) {
          controlledOnChange?.(level);
        } else {
          updateAgentChatConfig({ thinkingLevel: level });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<ThinkingLevel>
        defaultValue={defaultValue}
        levels={THINKING_LEVELS}
        minWidth={200}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default ThinkingLevelSlider;
