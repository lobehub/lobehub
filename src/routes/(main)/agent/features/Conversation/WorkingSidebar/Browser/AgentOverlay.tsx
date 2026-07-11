import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    pointer-events: none;

    position: absolute;
    z-index: 20;
    inset-block-start: 8px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 16px;

    font-size: 12px;
    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorBgMask};
    backdrop-filter: blur(4px);
  `,
  cursor: css`
    pointer-events: none;

    position: absolute;
    z-index: 20;

    margin-block-start: -4px;
    margin-inline-start: -4px;

    transition:
      inset-inline-start 0.4s cubic-bezier(0.3, 0.9, 0.4, 1),
      inset-block-start 0.4s cubic-bezier(0.3, 0.9, 0.4, 1);
  `,
  cursorLabel: css`
    position: absolute;
    inset-block-start: 18px;
    inset-inline-start: 13px;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 20px;

    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    color: #fff;
    white-space: nowrap;

    background: ${cssVar.geekblue};
    box-shadow: 0 1px 4px rgb(0 0 0 / 15%);
  `,
  cursorSvg: css`
    display: block;
    color: ${cssVar.geekblue};
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 30%));
  `,
  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};

    animation: lobe-browser-agent-pulse 1.2s ease-in-out infinite;

    @keyframes lobe-browser-agent-pulse {
      50% {
        opacity: 0.3;
      }
    }
  `,
  ripple: css`
    position: absolute;
    inset-block-start: -10px;
    inset-inline-start: -10px;

    width: 28px;
    height: 28px;
    border: 2px solid ${cssVar.geekblue};
    border-radius: 50%;

    opacity: 0;

    animation: lobe-browser-agent-ripple 0.5s ease-out 0.45s;

    @keyframes lobe-browser-agent-ripple {
      0% {
        transform: scale(0.4);
        opacity: 1;
      }

      100% {
        transform: scale(1.2);
        opacity: 0;
      }
    }
  `,
}));

interface AgentOverlayProps {
  sessionId: string;
}

/**
 * Draws the agent-control affordances above the webview: a floating cursor
 * that glides to each click target (broadcast by BrowserControlCtr before the
 * real input event lands) and a "controlling" status chip.
 */
const AgentOverlay = memo<AgentOverlayProps>(({ sessionId }) => {
  const { t } = useTranslation('chat');
  const [controlling, setControlling] = useState(false);
  const [cursor, setCursor] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  });
  // Remount the ripple animation per click.
  const [clickSeq, setClickSeq] = useState(0);

  useWatchBroadcast('browserSidebarAgentState', (data) => {
    if (data.sessionId !== sessionId) return;
    setControlling(data.active);
    if (!data.active) setCursor((prev) => ({ ...prev, visible: false }));
  });

  useWatchBroadcast('browserSidebarAgentCursor', (data) => {
    if (data.sessionId !== sessionId) return;
    setCursor({ visible: true, x: data.x, y: data.y });
    if (data.click) setClickSeq((n) => n + 1);
  });

  return (
    <>
      {controlling && (
        <Flexbox horizontal className={styles.chip}>
          <span className={styles.dot} />
          {t('workingPanel.browser.agentControlling')}
        </Flexbox>
      )}
      {cursor.visible && (
        <div
          className={styles.cursor}
          style={{ insetBlockStart: cursor.y, insetInlineStart: cursor.x }}
        >
          {clickSeq > 0 && <div className={styles.ripple} key={clickSeq} />}
          <svg className={styles.cursorSvg} fill="none" height={22} viewBox="0 0 24 24" width={22}>
            {/* White halo underneath the body. */}
            <path
              d="M5 3l14 8-6.5 1.5L9 19 5 3z"
              stroke="#fff"
              strokeLinejoin="round"
              strokeWidth={2.2}
            />
            {/* A same-color round-joined stroke softens the arrow's sharp
                vertices with a ~0.4 corner radius (radius = width / 2). */}
            <path
              d="M5 3l14 8-6.5 1.5L9 19 5 3z"
              fill="currentColor"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth={0.8}
            />
          </svg>
          <div className={styles.cursorLabel}>{t('workingPanel.browser.agentCursor')}</div>
        </div>
      )}
    </>
  );
});

AgentOverlay.displayName = 'AgentOverlay';

export default AgentOverlay;
