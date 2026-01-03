import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const GPT52ReasoningEffortSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const gpt5_2ReasoningEffort = config.gpt5_2ReasoningEffort || 'none';

  const marks = {
    0: 'none',
    1: 'low',
    2: 'medium',
    3: 'high',
    4: 'xhigh',
  };

  const effortValues = ['none', 'low', 'medium', 'high', 'xhigh'];
  const indexValue = effortValues.indexOf(gpt5_2ReasoningEffort);
  const currentValue = indexValue === -1 ? 0 : indexValue;

  const updateGPT52ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'none' | 'low' | 'medium' | 'high' | 'xhigh';
      updateAgentChatConfig({ gpt5_2ReasoningEffort: effort });
    },
    [updateAgentChatConfig],
  );

  return (
    <Flexbox
      align={'center'}
      gap={12}
      horizontal
      paddingInline={'0 20px'}
      style={{ minWidth: 230, width: '100%' }}
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={4}
          min={0}
          onChange={updateGPT52ReasoningEffort}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GPT52ReasoningEffortSlider;
