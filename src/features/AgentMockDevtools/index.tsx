import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useMatches } from 'react-router';

import { Controls } from './Controls';

const AgentMockPanel = memo(() => {
  const matches = useMatches();
  const isAgentTopicRoute = matches.some((m) => 'topicId' in m.params);

  return (
    <Flexbox gap={12} padding={16} style={{ marginInline: 'auto', maxWidth: 560, width: '100%' }}>
      {!isAgentTopicRoute && (
        <Text fontSize={12} type={'secondary'}>
          Open an agent topic conversation to replay mock cases into it.
        </Text>
      )}
      <Controls />
    </Flexbox>
  );
});

AgentMockPanel.displayName = 'AgentMockPanel';

export default AgentMockPanel;
