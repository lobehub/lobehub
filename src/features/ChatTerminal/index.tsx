'use client';

import { isDesktop } from '@lobechat/const';
import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { lazy, memo, Suspense, useEffect, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

// Content pulls in @xterm/xterm — keep it out of the main bundle until the
// panel is actually opened.
const Content = lazy(() => import('./Content'));

const styles = createStaticStyles(({ css }) => ({
  // DraggablePanel hard-codes `transition: all 0.2s` on its inner panel. The
  // doubled selector out-specifies that without !important, so the component's
  // own inline `transition: none` still wins while dragging (no lag on resize).
  smoothResize: css`
    && {
      transition: all 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    }
  `,
}));

// Keep in sync with the 0.3s height transition above: the panel must finish
// collapsing before the terminal is torn down.
const COLLAPSE_UNMOUNT_DELAY = 300;

/**
 * Codex-style built-in terminal: a full-width bottom panel on the chat page
 * with per-topic tab groups. Desktop-only.
 */
const ChatTerminalPanel = memo(() => {
  const [show, height, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.showTerminalPanel(s),
    systemStatusSelectors.terminalPanelHeight(s),
    s.updateSystemStatus,
  ]);

  // Open/close is driven by DraggablePanel's controlled `expand` so the panel
  // animates its height. The terminal is mounted while open and kept through
  // the collapse animation, then unmounted once hidden to release the xterm
  // canvas/WebGL context — the PTY and scrollback live in xtermManager, so
  // reopening re-attaches the same session.
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), COLLAPSE_UNMOUNT_DELAY);
    return () => clearTimeout(timer);
  }, [show]);

  if (!isDesktop) return null;

  return (
    <DraggablePanel
      backgroundColor={cssVar.colorBgContainer}
      classNames={{ content: styles.smoothResize }}
      expand={show}
      expandable={false}
      maxHeight={720}
      minHeight={160}
      placement={'bottom'}
      size={{ height, width: '100%' }}
      onSizeChange={(_, size) => {
        if (!size?.height) return;
        const next =
          typeof size.height === 'number' ? size.height : Number.parseInt(size.height, 10);
        if (Number.isFinite(next) && next > 0) {
          updateSystemStatus({ terminalPanelHeight: next });
        }
      }}
    >
      {mounted && (
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      )}
    </DraggablePanel>
  );
});

export default ChatTerminalPanel;
