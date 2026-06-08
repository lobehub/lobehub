import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import ContextWindow from '../ActionBar/Token';
import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore } from '../store';
import ApprovalMode from './ApprovalMode';
import ModeSelector from './ModeSelector';
import WorkspaceControls from './WorkspaceControls';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 0;
    padding-inline: 4px;
  `,
  // Left cluster (mode + device + working directory + git) is the variable-width
  // part. It shrinks first and, once its long labels have truncated as far as
  // they can, scrolls horizontally instead of wrapping each chip's text. The
  // scrollbar is hidden — trackpad / wheel still works.
  leftGroup: css`
    scrollbar-width: none;
    overflow: auto hidden;
    flex: 1;
    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  // Right cluster (approval mode + context window) stays pinned and intact.
  rightGroup: css`
    flex: none;
  `,
}));

const ControlBar = memo(() => {
  const agentId = useAgentId();
  const showContextWindow = useChatInputStore((s) =>
    s.rightActions.flat().includes('contextWindow'),
  );

  const [isLoading, enableAgentMode] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
  ]);

  // Skeleton placeholder to prevent layout jump during loading
  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 64, width: 64 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      {/* Left: chat-mode switcher + (agent-only) execution device + working directory */}
      <Flexbox horizontal align={'center'} className={styles.leftGroup} gap={4}>
        <ModeSelector />
        {enableAgentMode && <WorkspaceControls agentId={agentId} />}
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.rightGroup} gap={4}>
        {enableAgentMode && <ApprovalMode />}
        {showContextWindow && <ContextWindow />}
      </Flexbox>
    </Flexbox>
  );
});

ControlBar.displayName = 'ControlBar';

export default ControlBar;
