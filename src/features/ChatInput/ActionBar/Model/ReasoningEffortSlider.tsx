import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const ReasoningEffortSlider = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const reasoningEffort = config.reasoningEffort || 'medium'; // Default to 'medium' if not set

  const marks = {
    0: 'low',
    1: 'medium',
    2: 'high',
  };

  const effortValues = ['low', 'medium', 'high'];
  const indexValue = effortValues.indexOf(reasoningEffort);
  const currentValue = indexValue === -1 ? 1 : indexValue;

  const updateReasoningEffort = useCallback(
    (value: number) => {
      const effort = effortValues[value] as 'low' | 'medium' | 'high';
      updateAgentChatConfig({ reasoningEffort: effort });
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
          max={2}
          min={0}
          onChange={updateReasoningEffort}
          step={1}
          tooltip={{ open: false }}
          value={currentValue}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default ReasoningEffortSlider;
