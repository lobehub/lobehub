import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const THINKING_LEVELS_2 = ['low', 'high'] as const;
type ThinkingLevel2 = (typeof THINKING_LEVELS_2)[number];

export interface ThinkingLevel2SliderProps {
  defaultValue?: ThinkingLevel2;
  onChange?: (value: ThinkingLevel2) => void;
  value?: ThinkingLevel2;
}

const ThinkingLevel2Slider = memo<ThinkingLevel2SliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'high' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.thinkingLevel as ThinkingLevel2) || defaultValue;

    const handleChange = useCallback(
      (level: ThinkingLevel2) => {
        if (isControlled) {
          controlledOnChange?.(level);
        } else {
          updateAgentChatConfig({ thinkingLevel: level });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<ThinkingLevel2>
        defaultValue={defaultValue}
        levels={THINKING_LEVELS_2}
        minWidth={110}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default ThinkingLevel2Slider;
