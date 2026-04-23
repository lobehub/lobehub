'use client';

import type { ProcessInfo } from '@lobechat/electron-client-ipc';
import { ActionIcon, Tag } from '@lobehub/ui';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { styles } from './style';

interface Props {
  onKill: (shellId: string) => void;
  process: ProcessInfo;
}

const formatRuntime = (p: ProcessInfo): string => {
  const end = p.exitedAt ?? Date.now();
  const ms = Math.max(0, end - p.startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, '0')}s`;
};

const ProcessRow = memo<Props>(({ process, onKill }) => {
  const statusClass =
    process.status === 'running'
      ? styles.statusRunning
      : process.status === 'killed'
        ? styles.statusKilled
        : styles.statusExited;

  const commandLine = [process.command, ...process.args].join(' ');

  return (
    <div className={styles.row}>
      <div className={styles.commandCell} title={commandLine}>
        {commandLine}
      </div>
      <div>
        <Tag>{process.ownerModule}</Tag>
      </div>
      <div>{process.topicId ? <Tag>{process.topicId.slice(0, 8)}</Tag> : '—'}</div>
      <div>{process.pid || '—'}</div>
      <div className={statusClass}>
        {process.status} · {formatRuntime(process)}
      </div>
      <div>
        {process.status === 'running' && (
          <ActionIcon
            danger
            icon={XIcon}
            size={'small'}
            title={'Kill'}
            onClick={() => onKill(process.shellId)}
          />
        )}
      </div>
    </div>
  );
});

export default ProcessRow;
