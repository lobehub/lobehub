import type { PlaybackState } from '@lobechat/agent-mock';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  dotIdle: css`
    background: ${cssVar.colorTextTertiary};
  `,
  dotPlaying: css`
    background: ${cssVar.colorText};
    box-shadow: 0 0 0 3px ${cssVar.colorFillTertiary};
  `,
  dotError: css`
    background: ${cssVar.colorError};
  `,
  pill: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 3px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface StatusPillProps {
  playback: PlaybackState | null;
  speed: PlaybackState['speedMultiplier'];
}

export const StatusPill = memo<StatusPillProps>(({ playback, speed }) => {
  const tone = useMemo<'idle' | 'playing' | 'error'>(() => {
    if (!playback) return 'idle';
    if (playback.status === 'error') return 'error';
    if (playback.status === 'running' || playback.status === 'complete') return 'playing';
    return 'idle';
  }, [playback]);

  const dotClass =
    tone === 'error' ? styles.dotError : tone === 'playing' ? styles.dotPlaying : styles.dotIdle;

  const speedLabel = speed === 'instant' ? '∞' : `${speed}×`;

  return (
    <Flexbox horizontal align="center" className={styles.pill} gap={8}>
      <span className={`${styles.dot} ${dotClass}`} />
      {playback ? (
        <span>
          {playback.currentEventIndex}/{playback.totalEvents} · {speedLabel}
        </span>
      ) : (
        <span>idle · {speedLabel}</span>
      )}
    </Flexbox>
  );
});

StatusPill.displayName = 'AgentMockStatusPill';
