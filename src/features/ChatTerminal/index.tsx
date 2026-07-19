'use client';

import { isDesktop } from '@lobechat/const';
import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { lazy, memo, Suspense } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

// Content pulls in @xterm/xterm — keep it out of the main bundle until the
// panel is actually opened.
const Content = lazy(() => import('./Content'));

/**
 * Codex-style built-in terminal: a full-width bottom panel on the chat page
 * with per-topic tab groups. Desktop-only, gated behind the Labs toggle.
 */
const ChatTerminalPanel = memo(() => {
  const enableBuiltinTerminal = useUserStore(labPreferSelectors.enableBuiltinTerminal);
  const [show, height, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.showTerminalPanel(s),
    systemStatusSelectors.terminalPanelHeight(s),
    s.updateSystemStatus,
  ]);

  if (!isDesktop || !enableBuiltinTerminal || !show) return null;

  return (
    <DraggablePanel
      expand
      backgroundColor={cssVar.colorBgContainer}
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
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </DraggablePanel>
  );
});

export default ChatTerminalPanel;
