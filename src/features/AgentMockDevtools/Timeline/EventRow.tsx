import type { MockEvent } from '@lobechat/agent-mock';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

const COLOR_BY_TYPE: Record<string, string> = {
  stream_chunk: '#6b7280',
  stream_start: '#0ea5e9',
  stream_end: '#0ea5e9',
  tool_start: '#3b82f6',
  tool_end: '#10b981',
  tool_execute: '#8b5cf6',
  step_start: '#f59e0b',
  step_complete: '#f59e0b',
  error: '#ef4444',
};

const styles = createStaticStyles(({ css }) => ({
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 70px 30px 140px 1fr;
    gap: 8px;

    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ui-monospace, monospace;
    font-size: 11px;

    &:hover {
      background: ${cssVar.colorFillAlter};
    }
  `,
  active: css`
    background: ${cssVar.colorPrimaryBg};
  `,
  dot: css`
    width: 8px;
    height: 8px;
    margin-block-start: 4px;
    border-radius: 50%;
  `,
  type: css`
    color: ${cssVar.colorTextSecondary};
  `,
  preview: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface Props {
  cumulativeMs: number;
  event: MockEvent;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

const previewOf = (event: MockEvent): string => {
  const data = event.data as Record<string, unknown>;
  if (event.type === 'stream_chunk') {
    return String(data?.content ?? data?.reasoning ?? data?.chunkType ?? '').slice(0, 100);
  }
  if (event.type === 'tool_start' || event.type === 'tool_end') {
    return JSON.stringify(data).slice(0, 100);
  }
  if (event.type === 'error') return String(data?.message ?? '');
  return JSON.stringify(data).slice(0, 80);
};

export const EventRow = memo<Props>(({ event, index, cumulativeMs, isActive, onClick }) => (
  <div className={`${styles.row} ${isActive ? styles.active : ''}`} onClick={onClick}>
    <span className={styles.type}>+{(cumulativeMs / 1000).toFixed(2)}s</span>
    <span className={styles.dot} style={{ background: COLOR_BY_TYPE[event.type] ?? '#94a3b8' }} />
    <span className={styles.type}>
      #{index} {event.type}
    </span>
    <span className={styles.preview}>{previewOf(event)}</span>
  </div>
));

EventRow.displayName = 'AgentMockEventRow';
