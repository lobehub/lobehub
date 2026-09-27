import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { sectionStyles } from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';
import { electronDevtoolsService } from '@/services/electron/devtools';
import { useChatStore } from '@/store/chat';

import { type Activity, refreshActivities, useActivities } from './state';

export const topicName = (id?: string) => {
  if (!id) return undefined;
  const state = useChatStore.getState();
  return (
    state.topicDetailMap[id]?.title ??
    Object.values(state.topicDataMap)
      .flatMap((data) => data.items)
      .find((topic) => topic.id === id)?.title
  );
};

function ActivityRow({
  activity,
  selected,
  tree,
}: {
  activity: Activity;
  selected: boolean;
  tree: boolean;
}) {
  const { t } = useTranslation('chat');
  const [stopping, setStopping] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);
  return (
    <details
      ref={ref}
      style={{
        padding: 8,
        borderRadius: 6,
        background: selected ? cssVar.colorFillSecondary : undefined,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          color: activity.severity === 'normal' ? undefined : cssVar.colorWarning,
        }}
      >
        {activity.label} · {Math.round(activity.memoryMB)} MB ·{' '}
        {activity.cpuPercent === null ? '—' : `${Math.round(activity.cpuPercent)}%`} CPU
      </summary>
      <Flexbox gap={8} style={{ paddingTop: 8 }}>
        {activity.severity !== 'normal' && (
          <span role={'status'}>{t('backgroundActivity.highUsage')}</span>
        )}
        <span style={{ color: cssVar.colorTextSecondary }}>
          {t('backgroundActivity.processCount', { count: activity.processes.length })}
        </span>
        {tree &&
          activity.processes.map((row) => {
            let depth = 0;
            let parent = activity.processes.find((item) => item.pid === row.ppid);
            const seen = new Set([row.pid]);
            while (parent && !seen.has(parent.pid)) {
              seen.add(parent.pid);
              depth++;
              parent = activity.processes.find((item) => item.pid === parent!.ppid);
            }
            return (
              <div
                key={row.id}
                style={{
                  fontFamily: cssVar.fontFamilyCode,
                  fontSize: 12,
                  paddingInlineStart: depth * 12,
                }}
              >
                {row.name} · PID {row.pid} · {Math.round(row.memoryMB)} MB ·{' '}
                {row.cpuPercent === null ? '—' : `${Math.round(row.cpuPercent)}%`} CPU
              </div>
            );
          })}
        <Button
          disabled={stopping}
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            setStopping(true);
            try {
              await electronDevtoolsService.stopManagedProcess(activity.rootId);
              await refreshActivities();
            } catch (error) {
              console.error(error);
              toast.error(t('backgroundActivity.stopFailed'));
            } finally {
              setStopping(false);
            }
          }}
        >
          {t(stopping ? 'backgroundActivity.stopping' : 'backgroundActivity.stop')}
        </Button>
      </Flexbox>
    </details>
  );
}

export function BackgroundActivity({
  topicId,
  global = false,
}: {
  topicId?: string;
  global?: boolean;
}) {
  const { t } = useTranslation('chat');
  const state = useActivities();
  if (!isDesktop || (!global && !topicId)) return null;
  const activities = global
    ? state.activities
    : state.activities.filter((row) => row.topicId === topicId);
  const groups = global ? [...new Set(activities.map((row) => row.topicId))] : [topicId];
  return (
    <Flexbox className={sectionStyles.section} gap={4} style={{ overflow: 'auto' }}>
      <Flexbox horizontal className={sectionStyles.sectionHeader} justify={'space-between'}>
        <span className={sectionStyles.sectionTitle}>{t('backgroundActivity.title')}</span>
        {state.loaded && !state.error && (
          <span>
            {Math.round(activities.reduce((sum, row) => sum + row.memoryMB, 0))} MB ·{' '}
            {activities.some((row) => row.cpuPercent !== null)
              ? `${Math.round(activities.reduce((sum, row) => sum + (row.cpuPercent ?? 0), 0))}%`
              : '—'}{' '}
            CPU
          </span>
        )}
      </Flexbox>
      {state.error && (
        <Flexbox gap={4} role={'alert'}>
          <span>{t('backgroundActivity.unavailable')}</span>
          <Button size={'small'} onClick={() => void refreshActivities()}>
            {t('backgroundActivity.retry')}
          </Button>
        </Flexbox>
      )}
      {!state.loaded ? (
        <Skeleton.Text rows={2} />
      ) : activities.length === 0 && !state.error ? (
        <span style={{ padding: 8, color: cssVar.colorTextTertiary }}>
          {t('backgroundActivity.empty')}
        </span>
      ) : (
        groups.map((group) => (
          <Flexbox key={group ?? 'shared'}>
            {global && (
              <strong style={{ padding: 8 }}>
                {group
                  ? topicName(group) || `${t('backgroundActivity.topic')} · ${group}`
                  : t('backgroundActivity.shared')}
              </strong>
            )}
            {activities
              .filter((row) => row.topicId === group)
              .map((activity) => (
                <ActivityRow
                  activity={activity}
                  key={activity.rootId}
                  selected={state.selected === activity.rootId}
                  tree={global}
                />
              ))}
          </Flexbox>
        ))
      )}
    </Flexbox>
  );
}

export default function BackgroundActivityPanel() {
  return <BackgroundActivity global />;
}
