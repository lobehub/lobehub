import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import LevelSlider from './LevelSlider';

const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export interface ImageResolutionSliderProps {
  defaultValue?: ImageResolution;
  onChange?: (value: ImageResolution) => void;
  value?: ImageResolution;
}

const ImageResolutionSlider = memo<ImageResolutionSliderProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = '1K' }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    // Controlled mode: use props; Uncontrolled mode: use store
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;
    const currentValue = isControlled
      ? (controlledValue ?? defaultValue)
      : (config.imageResolution as ImageResolution) || defaultValue;

    const handleChange = useCallback(
      (resolution: ImageResolution) => {
        if (isControlled) {
          controlledOnChange?.(resolution);
        } else {
          updateAgentChatConfig({ imageResolution: resolution });
        }
      },
      [isControlled, controlledOnChange, updateAgentChatConfig],
    );

    return (
      <LevelSlider<ImageResolution>
        defaultValue={defaultValue}
        levels={IMAGE_RESOLUTIONS}
        minWidth={150}
        onChange={handleChange}
        value={currentValue}
      />
    );
  },
);

export default ImageResolutionSlider;
