import type { MockEvent } from '@lobechat/agent-mock';
import { Center, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { useAgentMockPlayer } from '../hooks/useAgentMockPlayer';
import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';
import { EventRow } from '../Timeline/EventRow';

const styles = createStaticStyles(({ css }) => ({
  list: css`
    overflow: hidden;
    flex: 1;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  meta: css`
    margin-block-end: 8px;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  wrap: css`
    display: flex;
    flex: 1;
    flex-direction: column;

    height: 100%;
    min-height: 0;
  `,
}));

export const TimelineView = memo(() => {
  const { all } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const playback = useAgentMockStore((s) => s.playback);
  const { seekToEventIndex } = useAgentMockPlayer();
  const c = all.find((x) => x.id === selectedCaseId);

  const events = useMemo<MockEvent[]>(() => {
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
        onClick={() => seekToEventIndex(idx)}
      />
    ),
    [cumulative, playback?.currentEventIndex, seekToEventIndex],
  );

  if (!c) {
    return (
      <Center flex={1}>
        <Text type="secondary">Pick a case to begin.</Text>
      </Center>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.meta}>
        {events.length} events · {((cumulative.at(-1) ?? 0) / 1000).toFixed(1)}s total
      </div>
      <div className={styles.list}>
        <Virtuoso data={events} itemContent={renderItem} />
      </div>
    </div>
  );
});

TimelineView.displayName = 'AgentMockTimelineView';
