import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

const ImageResolutionSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const imageResolution = (config.imageResolution as ImageResolution) || '1K';

  const marks = {
    0: '1K',
    1: '2K',
    2: '4K',
  };

  const indexValue = IMAGE_RESOLUTIONS.indexOf(imageResolution);
  const currentValue = indexValue === -1 ? 0 : indexValue;

  const updateResolution = useCallback(
    (value: number) => {
      const resolution = IMAGE_RESOLUTIONS[value];
      updateAgentChatConfig({ imageResolution: resolution });
    },
    [updateAgentChatConfig],
  );

  return (
    <Flexbox
      align={'center'}
      gap={12}
      horizontal
      paddingInline={'0 20px'}
      style={{ minWidth: 150, width: '100%' }}
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={2}
          min={0}
          onChange={updateResolution}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default ImageResolutionSlider;
