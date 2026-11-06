import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';

import { fetchCurrent, type FollowInfo } from '../api';
import { Chip } from './Chip';

const POLL_MS = 5000;

const styles = stylex.create({
  badge: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    columnGap: 6,
    display: 'inline-flex',
    fontSize: 12.5,
  },
});

const timeOf = (startedAt: string | undefined) =>
  startedAt ? new Date(startedAt).toLocaleString('zh-CN', { hour12: false }) : undefined;

export const useFollowRun = (follow: FollowInfo | undefined, reload: () => void) => {
  const runId = follow?.runId;
  const pinned = follow?.pinned ?? true;
  useEffect(() => {
    if (!runId || pinned) return;
    const timer = window.setInterval(() => {
      fetchCurrent()
        .then((next) => next.runId !== runId && reload())
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pinned, reload, runId]);
};

export const RunBadge = ({ follow }: { follow?: FollowInfo }) => {
  if (!follow) return null;
  const time = timeOf(follow.startedAt);
  return (
    <span {...stylex.props(styles.badge)} title={follow.runId}>
      <span>
        运行 {follow.head.slice(0, 7)}
        {time ? ` · ${time}` : ''}
      </span>
      {follow.pinned ? (
        <Chip tone="plain">已固定这次运行</Chip>
      ) : follow.runId === follow.requested ? null : (
        <Chip title={`启动时打开的是 ${follow.requested}`} tone="info">
          已自动切到最新一次运行
        </Chip>
      )}
    </span>
  );
};
