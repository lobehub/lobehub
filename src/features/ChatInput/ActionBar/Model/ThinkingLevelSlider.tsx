import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const ThinkingLevelSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const thinkingLevel = config.thinkingLevel || 'high'; // Default to 'high' if not set

  const marks = {
    0: 'low',
    1: 'high',
  };

  const levelValues = ['low', 'high'];
  const indexValue = levelValues.indexOf(thinkingLevel);
  const currentValue = indexValue === -1 ? 1 : indexValue;

  const updateThinkingLevel = useCallback(
    (value: number) => {
      const level = levelValues[value] as 'low' | 'high';
      updateAgentChatConfig({ thinkingLevel: level });
    },
    [updateAgentChatConfig],
  );

  return (
    <Flexbox
      align={'center'}
      gap={12}
      horizontal
      paddingInline={'0 20px'}
      style={{ minWidth: 130, width: '100%' }} // 三项时宽度需改回 200
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={1}
          min={0}
          onChange={updateThinkingLevel}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default ThinkingLevelSlider;
