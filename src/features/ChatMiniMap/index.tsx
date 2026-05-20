'use client';

import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo, useRef, useState } from 'react';

import { MinimapIndicator } from './MinimapIndicator';
import { MinimapPreview } from './MinimapPreview';
import { minimapStyles } from './styles';
import { useMinimapData } from './useMinimapData';
import { MIN_MESSAGES_THRESHOLD } from './utils';

const CLOSE_DELAY_MS = 120;

const ChatMinimap = memo(() => {
  const styles = minimapStyles;
  const [hovered, setHovered] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { indicators, activeIndicatorPosition, handleJump } = useMinimapData();

  if (indicators.length <= MIN_MESSAGES_THRESHOLD) return null;

  const handleEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHovered(true);
  };

  const handleLeave = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHovered(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  };

  const handleJumpAndClose = (virtuosoIndex: number) => {
    handleJump(virtuosoIndex);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setHovered(false);
  };

  return (
    <Flexbox className={styles.container}>
      <Flexbox className={styles.hoverArea} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <Flexbox className={cx(styles.rail, hovered && styles.railFaded)} role={'group'}>
          {indicators.map(({ id, width, virtuosoIndex }, position) => (
            <MinimapIndicator
              activePosition={activeIndicatorPosition}
              id={id}
              key={id}
              position={position}
              virtuosoIndex={virtuosoIndex}
              width={width}
              onJump={handleJump}
            />
          ))}
        </Flexbox>
        <div
          aria-hidden={!hovered}
          className={cx(styles.previewPanel, hovered && styles.previewPanelVisible)}
        >
          <MinimapPreview
            activePosition={activeIndicatorPosition}
            indicators={indicators}
            onJump={handleJumpAndClose}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

ChatMinimap.displayName = 'ChatMinimap';

export default ChatMinimap;
