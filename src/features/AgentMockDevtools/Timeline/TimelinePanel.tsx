import type { MockEvent } from '@lobechat/agent-mock';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';
import { EventRow } from './EventRow';

const styles = createStaticStyles(({ css }) => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `,
  list: css`
    overflow: hidden;
    flex: 1;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,
}));

export const TimelinePanel = memo(() => {
  const { all } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const playback = useAgentMockStore((s) => s.playback);
  const c = all.find((x) => x.id === selectedCaseId);

  const events = useMemo(() => {
    if (!c) return [];
    if (c.source.type === 'fixture') return c.source.events;
    if (c.source.type === 'snapshot') return c.source.events ?? [];
    if (c.source.type === 'generator') return c.source.events ?? [];
    return [];
  }, [c]);

  const cumulative = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const e of events) {
      acc += e.delay ?? 0;
      out.push(acc);
    }
    return out;
  }, [events]);

  const renderItem = useCallback(
    (idx: number, ev: MockEvent) => (
      <EventRow
        cumulativeMs={cumulative[idx] ?? 0}
        event={ev}
        index={idx}
        isActive={playback?.currentEventIndex === idx}
      />
    ),
    [cumulative, playback?.currentEventIndex],
  );

  if (!c) return <div style={{ color: 'var(--lobe-color-text-secondary)' }}>Select a case.</div>;

  return (
    <div className={styles.wrap}>
      <div style={{ marginBlockEnd: 8, fontSize: 11, color: 'var(--lobe-color-text-tertiary)' }}>
        {events.length} events · {(cumulative.at(-1) ?? 0) / 1000} s total
      </div>
      <div className={styles.list}>
        <Virtuoso data={events} itemContent={renderItem} />
      </div>
    </div>
  );
});

TimelinePanel.displayName = 'AgentMockTimelinePanel';
