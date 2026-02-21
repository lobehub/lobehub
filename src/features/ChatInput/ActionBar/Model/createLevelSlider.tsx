'use client';

import { type LobeAgentChatConfig } from '@lobechat/types';
import { type SliderSingleProps } from 'antd/es/slider';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

export interface LevelSliderConfig<T extends string> {
  /**
   * The key in LobeAgentChatConfig to read/write
   */
  configKey: keyof LobeAgentChatConfig;
  /**
   * Default value when no value is provided
   */
  defaultValue: T;
  /**
   * Ordered array of level values (left to right on slider)
   */
  levels: readonly T[];
  /**
   * Optional custom marks for the slider
   */
  marks?: SliderSingleProps['marks'];
  /**
   * Optional style for the slider container
   */
  style?: CSSProperties;
}

export interface CreatedLevelSliderProps<T extends string> {
  defaultValue?: T;
  onChange?: (value: T) => void;
  value?: T;
}

/**
 * Factory function to create a level slider component that supports both
 * controlled mode (for previews without store access) and uncontrolled mode
 * (reading/writing to agent store).
 */
export function createLevelSliderComponent<T extends string>(config: LevelSliderConfig<T>) {
  const { levels, configKey, defaultValue, marks, style } = config;

  // Inner pure UI component - no store hooks, safe for preview
  const LevelSliderInner = memo<{
    defaultValue: T;
    onChange: (_v: T) => void;
    value: T;
  }>(({ value, onChange, defaultValue: dv }) => (
    <LevelSlider<T>
      defaultValue={dv}
      levels={levels}
      marks={marks}
      style={style}
      value={value}
      onChange={onChange}
    />
  ));

  // Store-connected component - uses agent store hooks
  const LevelSliderWithStore = memo<{ defaultValue: T }>(({ defaultValue: dv }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const agentConfig = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    const storeValue = (agentConfig[configKey] as T) || dv;

    const handleChange = (newValue: T) => {
      updateAgentChatConfig({ [configKey]: newValue });
    };

    return <LevelSliderInner defaultValue={dv} value={storeValue} onChange={handleChange} />;
  });

  // Main exported component - chooses between controlled and store mode
  const CreatedLevelSlider = memo<CreatedLevelSliderProps<T>>(
    ({ value: controlledValue, onChange: controlledOnChange, defaultValue: propDefaultValue }) => {
      const dv = propDefaultValue ?? defaultValue;
      const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;

      if (isControlled) {
        // Controlled mode: use props only, no store access
        return (
          <LevelSliderInner
            defaultValue={dv}
            value={controlledValue ?? dv}
            onChange={controlledOnChange ?? (() => {})}
          />
        );
      }

      // Uncontrolled mode: use store
      return <LevelSliderWithStore defaultValue={dv} />;
    },
  );

  return CreatedLevelSlider;
}
