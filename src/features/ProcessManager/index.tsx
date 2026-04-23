'use client';

import type { ProcessInfo } from '@lobechat/electron-client-ipc';
import { Button, Segmented, Text } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import ProcessRow from './ProcessRow';
import { styles } from './style';
import { useProcessList } from './useProcessList';

type GroupBy = 'none' | 'topic' | 'module' | 'status';

const groupProcesses = (processes: ProcessInfo[], by: GroupBy): [string, ProcessInfo[]][] => {
  if (by === 'none') return [['All', processes]];
  const groups = new Map<string, ProcessInfo[]>();
  for (const p of processes) {
    const key =
      by === 'topic' ? (p.topicId ?? '(no topic)') : by === 'module' ? p.ownerModule : p.status;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const ProcessManagerPanel = memo(() => {
  const { items, loading, kill, refetch } = useProcessList();
  const [groupBy, setGroupBy] = useState<GroupBy>('module');
  const [showExited, setShowExited] = useState(false);

  const filtered = useMemo(
    () => (showExited ? items : items.filter((p) => p.status === 'running')),
    [items, showExited],
  );

  const grouped = useMemo(() => groupProcesses(filtered, groupBy), [filtered, groupBy]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Text strong>
          Processes ({filtered.length} / {items.length})
        </Text>
        <Segmented
          size={'small'}
          value={groupBy}
          options={[
            { label: 'By Module', value: 'module' },
            { label: 'By Topic', value: 'topic' },
            { label: 'By Status', value: 'status' },
            { label: 'Flat', value: 'none' },
          ]}
          onChange={(v) => setGroupBy(v as GroupBy)}
        />
        <Button size={'small'} type={'text'} onClick={() => setShowExited((v) => !v)}>
          {showExited ? 'Hide exited' : 'Show exited'}
        </Button>
        <Button size={'small'} type={'text'} onClick={refetch}>
          Refresh
        </Button>
      </div>

      {loading && <div className={styles.empty}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>No tracked processes.</div>
      )}

      {!loading &&
        grouped.map(([groupKey, rows]) => (
          <div key={groupKey}>
            {groupBy !== 'none' && (
              <div className={styles.groupHeader}>
                {groupKey} ({rows.length})
              </div>
            )}
            <div className={styles.rowHeader}>
              <div>Command</div>
              <div>Module</div>
              <div>Topic</div>
              <div>PID</div>
              <div>Status</div>
              <div />
            </div>
            {rows.map((p) => (
              <ProcessRow key={p.shellId} process={p} onKill={kill} />
            ))}
          </div>
        ))}
    </div>
  );
});

export default ProcessManagerPanel;
