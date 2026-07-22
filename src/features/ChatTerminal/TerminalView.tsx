'use client';

import { useTheme } from 'antd-style';
import { memo, useEffect, useRef } from 'react';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { buildXtermTheme } from './theme';
import { xtermManager } from './xtermManager';

/**
 * Attaches the keep-alive xterm instance of `sessionId` to the DOM. The
 * instance itself (and its scrollback) lives in `xtermManager`, so unmounting
 * this view — collapsing the panel, switching tab or topic — loses nothing.
 */
const TerminalView = memo<{ sessionId: string }>(({ sessionId }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const terminalFontFamily = useUserStore(preferenceSelectors.terminalFontFamily);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    xtermManager.attach(sessionId, host);
    xtermManager.fit(sessionId);
    xtermManager.focus(sessionId);

    const observer = new ResizeObserver(() => xtermManager.fit(sessionId));
    observer.observe(host);

    return () => {
      observer.disconnect();
      xtermManager.detach(sessionId);
    };
  }, [sessionId]);

  useEffect(() => {
    xtermManager.applyTheme(buildXtermTheme(theme), terminalFontFamily || theme.fontFamilyCode);
  }, [terminalFontFamily, theme, sessionId]);

  return (
    <div
      ref={hostRef}
      style={{ height: '100%', minHeight: 0, overflow: 'hidden', width: '100%' }}
    />
  );
});

export default TerminalView;
