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
    0: 'minimal',
    1: 'low',
    2: 'medium',
    3: 'high',
  };

  const levelValues = ['minimal', 'low', 'medium', 'high'];
  const indexValue = levelValues.indexOf(thinkingLevel as any);
  const currentValue = indexValue === -1 ? 3 : indexValue;

  const updateThinkingLevel = useCallback(
    (value: number) => {
      const level = levelValues[value] as 'minimal' | 'low' | 'medium' | 'high';
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
      style={{ minWidth: 200, width: '100%' }}
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={3}
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
