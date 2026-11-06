import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useMatches } from 'react-router';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { Controls } from './Controls';

const styles = stylex.create({
  notice: {
    display: 'block',
    flexShrink: 0,
    padding: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

const AgentMockPanel = memo(() => {
  const matches = useMatches();
  const isAgentTopicRoute = matches.some((m) => 'topicId' in m.params);

  return (
    <div {...stylex.props(devDockPanelStyles.root)}>
      {!isAgentTopicRoute && (
        <Text className={stylex.props(styles.notice).className} fontSize={12} type={'secondary'}>
          Open an agent topic conversation to replay mock cases into it.
        </Text>
      )}
      <Controls />
    </div>
  );
});

AgentMockPanel.displayName = 'AgentMockPanel';

export default AgentMockPanel;
