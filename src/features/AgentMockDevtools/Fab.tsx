import { Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Bot } from 'lucide-react';
import { memo } from 'react';

import { useAgentMockStore } from './store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  fab: css`
    cursor: pointer;
    user-select: none;

    position: fixed;
    z-index: 1100;
    inset-block-end: 16px;
    inset-inline-end: 16px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 50%;

    color: #fff;

    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    box-shadow: 0 4px 14px rgb(99 102 241 / 40%);

    &:hover {
      transform: scale(1.05);
    }
  `,
  ring: css`
    position: absolute;
    inset: -3px;

    border: 2px solid transparent;
    border-block-start-color: #fff;
    border-inline-end-color: #fff;
    border-radius: 50%;

    animation: agent-mock-spin 1.6s linear infinite;

    @keyframes agent-mock-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

export const Fab = memo(() => {
  const setModalState = useAgentMockStore((s) => s.setModalState);
  const playback = useAgentMockStore((s) => s.playback);
  const playing = playback?.status === 'running';

  return (
    <Tooltip title="Agent Mock (dev only)">
      <div className={styles.fab} onClick={() => setModalState('open')}>
        <Bot size={18} />
        {playing && <span className={styles.ring} />}
      </div>
    </Tooltip>
  );
});

Fab.displayName = 'AgentMockFab';
