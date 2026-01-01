import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const GPT52ProReasoningEffortSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const gpt5_2ProReasoningEffort = config.gpt5_2ProReasoningEffort || 'medium';

  const marks = {
    0: 'medium',
    1: 'high',
    2: 'xhigh',
  };

  const effortValues = ['medium', 'high', 'xhigh'];
  const indexValue = effortValues.indexOf(gpt5_2ProReasoningEffort);
  const currentValue = indexValue === -1 ? 0 : indexValue;

  const updateGPT52ProReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'medium' | 'high' | 'xhigh';
      updateAgentChatConfig({ gpt5_2ProReasoningEffort: effort });
    },
    [updateAgentChatConfig],
  );

  return (
    <Flexbox
      align={'center'}
      gap={12}
      horizontal
      paddingInline={'0 20px'}
      style={{ minWidth: 160, width: '100%' }}
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={2}
          min={0}
          onChange={updateGPT52ProReasoningEffort}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default GPT52ProReasoningEffortSlider;
