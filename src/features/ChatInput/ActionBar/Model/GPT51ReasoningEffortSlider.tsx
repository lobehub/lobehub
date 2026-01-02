import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const GPT51ReasoningEffortSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const gpt5_1ReasoningEffort = config.gpt5_1ReasoningEffort || 'none'; // Default to 'none' if not set

  const marks = {
    0: 'none',
    1: 'low',
    2: 'medium',
    3: 'high',
  };

  const effortValues = ['none', 'low', 'medium', 'high'];
  const indexValue = effortValues.indexOf(gpt5_1ReasoningEffort);
  const currentValue = indexValue === -1 ? 0 : indexValue;

  const updateGPT51ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'none' | 'low' | 'medium' | 'high';
      updateAgentChatConfig({ gpt5_1ReasoningEffort: effort });
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
          onChange={updateGPT51ReasoningEffort}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GPT51ReasoningEffortSlider;
