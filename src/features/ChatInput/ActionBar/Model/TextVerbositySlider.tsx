import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const TEXT_VERBOSITY_LEVELS = ['low', 'medium', 'high'] as const;
type TextVerbosity = (typeof TEXT_VERBOSITY_LEVELS)[number];

export interface TextVerbositySliderProps {
  defaultValue?: TextVerbosity;
  onChange?: (value: TextVerbosity) => void;
  value?: TextVerbosity;
}

const TextVerbositySlider = memo<TextVerbositySliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = 'medium' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.textVerbosity as TextVerbosity) || defaultValue;

    const handleChange = useCallback(
      (verbosity: TextVerbosity) => {
        if (isControlled) {
          controlledOnChange?.(verbosity);
        } else {
          updateAgentChatConfig({ textVerbosity: verbosity });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<TextVerbosity>
        defaultValue={defaultValue}
        levels={TEXT_VERBOSITY_LEVELS}
        minWidth={160}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default TextVerbositySlider;
