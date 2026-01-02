import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const GPT5ReasoningEffortSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const gpt5ReasoningEffort = config.gpt5ReasoningEffort || 'medium'; // Default to 'medium' if not set

  const marks = {
    0: 'minimal',
    1: 'low',
    2: 'medium',
    3: 'high',
  };

  const effortValues = ['minimal', 'low', 'medium', 'high'];
  const indexValue = effortValues.indexOf(gpt5ReasoningEffort);
  const currentValue = indexValue === -1 ? 2 : indexValue;

  const updateGPT5ReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'minimal' | 'low' | 'medium' | 'high';
      updateAgentChatConfig({ gpt5ReasoningEffort: effort });
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
          onChange={updateGPT5ReasoningEffort}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GPT5ReasoningEffortSlider;
