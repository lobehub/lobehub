import { Flexbox, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';

import { CaseTrigger } from './CaseTrigger';
import { StatsStrip } from './components/StatsStrip';
import { StatusPill } from './components/StatusPill';
import { TransportBar } from './components/TransportBar';
import { useAgentMockPlayer } from './hooks/useAgentMockPlayer';
import { useAgentMockReplayTarget } from './hooks/useAgentMockReplayTarget';
import { useMockCases } from './hooks/useMockCases';
import { type DevtoolsTab, useAgentMockStore } from './store/agentMockStore';
import { FixtureView } from './views/FixtureView';
import { TimelineView } from './views/TimelineView';

const TAB_OPTIONS: Array<{ label: string; value: DevtoolsTab }> = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Fixture', value: 'fixture' },
];

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;

    padding: 16px;
  `,
  hint: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  layout: css`
    display: flex;
    flex-direction: column;
    height: min(720px, 80vh);
    min-height: 480px;
  `,
  meta: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowOne: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  rowTwo: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  view: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
}));

export const DevtoolsLayout = memo(() => {
  const activeTab = useAgentMockStore((s) => s.activeTab);
  const setActiveTab = useAgentMockStore((s) => s.setActiveTab);
  const playback = useAgentMockStore((s) => s.playback);
  const speed = useAgentMockStore((s) => s.speed);
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const loop = useAgentMockStore((s) => s.loop);

  const { all } = useMockCases();
  const selected = all.find((c) => c.id === selectedCaseId);

  const { start } = useAgentMockPlayer();
  const resolveReplayTarget = useAgentMockReplayTarget();

  const lastReplayedId = useRef<string | null>(null);

  const launchCase = useCallback(() => {
    if (!selected) return;
    const { agentId, threadId, topicId } = resolveReplayTarget();
    if (!agentId || !topicId) return;
    start({ agentId, case: selected, threadId, topicId });
  }, [resolveReplayTarget, selected, start]);

  useEffect(() => {
    if (!loop) {
      lastReplayedId.current = null;
      return;
    }
    if (!playback || playback.status !== 'complete') return;
    if (!selected) return;
    if (lastReplayedId.current === selected.id) return;
    lastReplayedId.current = selected.id;
    launchCase();
  }, [loop, playback, selected, launchCase]);

  useEffect(() => {
    if (playback?.status === 'running') {
      lastReplayedId.current = null;
    }
  }, [playback?.status]);

  const meta = useMemo(() => {
    if (!selected) return null;
    const events =
      selected.source.type === 'fixture'
        ? selected.source.events.length
        : (selected.source.events?.length ?? 0);
    const tools = selected.meta?.toolCount;
    const totalSec = selected.meta?.estimatedDurationMs
      ? `~${(selected.meta.estimatedDurationMs / 1000).toFixed(1)}s`
      : null;
    return [`${events} events`, tools != null ? `${tools} tools` : null, totalSec]
      .filter(Boolean)
      .join(' · ');
  }, [selected]);

  return (
    <div className={styles.layout}>
      <Flexbox horizontal align="center" className={styles.rowOne} gap={12}>
        <CaseTrigger />
        <span className={styles.meta}>
          {selected ? (
            <Flexbox horizontal align="center" gap={8}>
              {selected.tags?.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
              {meta && <Text type="secondary">{meta}</Text>}
            </Flexbox>
          ) : (
            <Text type="secondary">No case selected</Text>
          )}
        </span>
        <StatusPill playback={playback} speed={speed} />
      </Flexbox>

      <Flexbox horizontal align="center" className={styles.rowTwo} justify="space-between">
        <Segmented
          options={TAB_OPTIONS}
          size="small"
          value={activeTab}
          onChange={(value) => setActiveTab(value as DevtoolsTab)}
        />
        <span className={styles.hint}>⌘K open palette</span>
      </Flexbox>

      <div className={styles.body}>
        <StatsStrip />
        <div className={styles.view}>
          {activeTab === 'timeline' ? <TimelineView /> : <FixtureView />}
        </div>
      </div>

      <TransportBar />
    </div>
  );
});

DevtoolsLayout.displayName = 'AgentMockDevtoolsLayout';
