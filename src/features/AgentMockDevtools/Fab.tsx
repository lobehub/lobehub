import { Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
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
    border: 1px solid transparent;
    border-radius: 50%;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
    box-shadow: 0 2px 8px rgb(0 0 0 / 12%);

    transition:
      transform 160ms ease,
      background 160ms ease,
      color 160ms ease,
      border-color 160ms ease;

    &:hover {
      transform: scale(1.04);
    }
  `,
  fabActive: css`
    border-color: ${cssVar.colorBorder};
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  ring: css`
    pointer-events: none;

    position: absolute;
    inset: -3px;

    border: 1.5px solid ${cssVar.colorText};
    border-radius: 50%;

    opacity: 0.4;

    animation: agent-mock-pulse 2.4s ease-in-out infinite;

    @keyframes agent-mock-pulse {
      0%,
      100% {
        opacity: 0.3;
      }

      50% {
        opacity: 0.8;
      }
    }
  `,
}));

export const Fab = memo(() => {
  const popoverOpen = useAgentMockStore((s) => s.popoverOpen);
  const setPopoverOpen = useAgentMockStore((s) => s.setPopoverOpen);
  const modalOpen = useAgentMockStore((s) => s.modalOpen);
  const playback = useAgentMockStore((s) => s.playback);
  const playing = playback?.status === 'running';

  if (modalOpen) return null;

  return (
    <Tooltip title="Agent Mock (dev only)">
      <div
        className={`${styles.fab} ${popoverOpen ? styles.fabActive : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => setPopoverOpen(!popoverOpen)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setPopoverOpen(!popoverOpen);
          }
        }}
      >
        <Bot size={18} />
        {playing && <span className={styles.ring} />}
      </div>
    </Tooltip>
  );
});

Fab.displayName = 'AgentMockFab';
