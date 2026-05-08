import type { MockEvent } from '@lobechat/agent-mock';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

type EventTone = 'info' | 'neutral' | 'muted' | 'error';

const TONE_BY_TYPE: Record<string, EventTone> = {
  error: 'error',
  step_complete: 'neutral',
  step_start: 'neutral',
  stream_chunk: 'neutral',
  stream_end: 'muted',
  stream_start: 'muted',
  tool_end: 'info',
  tool_execute: 'info',
  tool_start: 'info',
};

const toneVar: Record<EventTone, string> = {
  error: cssVar.colorError,
  info: cssVar.colorText,
  muted: cssVar.colorTextQuaternary,
  neutral: cssVar.colorTextTertiary,
};

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillSecondary};
  `,
  dot: css`
    width: 6px;
    height: 6px;
    margin-block-start: 5px;
    border-radius: 50%;
  `,
  preview: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 64px 16px 140px 1fr;
    gap: 8px;

    padding-block: 4px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  type: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface Props {
  cumulativeMs: number;
  event: MockEvent;
  index: number;
  isActive: boolean;
  onClick?: () => void;
}

const previewOf = (event: MockEvent): string => {
  const data =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>)
      : {};
  if (event.type === 'stream_chunk') {
    return String(data.content ?? data.reasoning ?? data.chunkType ?? '').slice(0, 100);
  }
  if (event.type === 'tool_start' || event.type === 'tool_end') {
    return JSON.stringify(data).slice(0, 100);
  }
  if (event.type === 'error') return String(data.message ?? '');
  return JSON.stringify(data).slice(0, 80);
};

export const EventRow = memo<Props>(({ event, index, cumulativeMs, isActive, onClick }) => {
  const tone = TONE_BY_TYPE[event.type] ?? 'neutral';

  return (
    <div className={`${styles.row} ${isActive ? styles.active : ''}`} onClick={onClick}>
      <span className={styles.type}>+{(cumulativeMs / 1000).toFixed(2)}s</span>
      <span className={styles.dot} style={{ background: toneVar[tone] }} />
      <span className={styles.type}>
        #{index} {event.type}
      </span>
      <span className={styles.preview}>{previewOf(event)}</span>
    </div>
  );
});

EventRow.displayName = 'AgentMockEventRow';
