import { Button, Empty, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronRightIcon,
  CpuIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { sx } from '@/styles/sx';

import {
  type Activity,
  formatCpu,
  formatMemory,
  processTree,
  refreshActivities,
  useActivities,
} from './state';
import StopButton from './StopButton';

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

const GRID = '16px minmax(0, 1fr) 88px 72px 56px 28px';

const tableStyles = stylex.create({
  alert: {
    alignItems: 'center',
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    color: cssVar.colorError,
    display: 'flex',
    fontSize: '12px',
    gap: '8px',
    paddingBlock: '8px',
    paddingInline: '12px',
  },
  chevron: {
    color: cssVar.colorTextQuaternary,
    transition: 'transform 0.15s ease',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  critical: {
    color: cssVar.colorError,
  },
  group: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    fontSize: '12px',
    fontWeight: 600,
    gap: '6px',
    height: '30px',
    insetBlockStart: 0,
    paddingInline: '12px',
    position: 'sticky',
    zIndex: 1,
  },
  head: {
    alignItems: 'center',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    color: cssVar.colorTextTertiary,
    display: 'grid',
    fontSize: '11px',
    gap: '8px',
    height: '28px',
    paddingInline: '12px',
  },
  headLabel: {
    color: cssVar.colorTextTertiary,
    fontSize: '11px',
    fontWeight: 600,
  },
  headNum: {
    textAlign: 'end',
  },
  label: {
    alignItems: 'center',
    color: cssVar.colorText,
    display: 'flex',
    fontSize: '13px',
    gap: '6px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  num: {
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
  },
  proc: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    color: cssVar.colorTextSecondary,
    display: 'grid',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11.5px',
    gap: '8px',
    height: '26px',
    paddingInline: '12px',
  },
  procName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: {
    alignItems: 'center',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    cursor: 'pointer',
    display: 'grid',
    gap: '8px',
    height: '36px',
    paddingInline: '12px',
  },
  // Hover still wins over the selected fill, as it did with the original cascade.
  selected: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  stale: {
    opacity: 0.55,
  },
  warning: {
    color: cssVar.colorWarning,
  },
});

export function TopicTitle({ id }: { id: string }) {
  const { t } = useTranslation('chat');
  const title = useChatStore(() => topicName(id));
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  useFetchTopicDetail(title ? undefined : id);
  return title || t('backgroundActivity.topic');
}

function ActivityRows({ activity, selected }: { activity: Activity; selected: boolean }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(selected);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const alert = activity.severity !== 'normal';
  const tone = activity.severity === 'critical' ? tableStyles.critical : tableStyles.warning;
  return (
    <>
      <div
        aria-expanded={open}
        {...sx([tableStyles.row, selected && tableStyles.selected], undefined, {
          gridTemplateColumns: GRID,
        })}
        ref={ref}
        role={'button'}
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <Icon
          className={stylex.props(tableStyles.chevron, open && tableStyles.chevronOpen).className}
          icon={ChevronRightIcon}
          size={14}
        />
        <span {...stylex.props(tableStyles.label)} title={activity.label}>
          {alert && (
            <Icon className={stylex.props(tone).className} icon={TriangleAlertIcon} size={14} />
          )}
          {activity.label}
        </span>
        <span {...stylex.props(tableStyles.num)}>
          {t('backgroundActivity.processCount', { count: activity.processes.length })}
        </span>
        <span {...stylex.props(tableStyles.num, alert && tone)}>
          {formatMemory(activity.memoryMB)}
        </span>
        <span {...stylex.props(tableStyles.num)}>{formatCpu(activity.cpuPercent)}</span>
        <StopButton rootId={activity.rootId} />
      </div>
      {open &&
        processTree(activity.processes).map(({ depth, row }) => (
          <div {...sx([tableStyles.proc], undefined, { gridTemplateColumns: GRID })} key={row.id}>
            <span />
            <span {...sx([tableStyles.procName], undefined, { paddingInlineStart: depth * 14 })}>
              {depth > 0 && '└ '}
              {row.name}
            </span>
            <span {...stylex.props(tableStyles.num)}>{row.pid}</span>
            <span {...stylex.props(tableStyles.num)}>{formatMemory(row.memoryMB)}</span>
            <span {...stylex.props(tableStyles.num)}>{formatCpu(row.cpuPercent)}</span>
            <span />
          </div>
        ))}
    </>
  );
}

export default function ActivityTable() {
  const { t } = useTranslation('chat');
  const state = useActivities();
  if (!state.loaded)
    return (
      <Flexbox padding={12}>
        <Skeleton.Text rows={3} />
      </Flexbox>
    );
  const groups = [...new Set(state.activities.map((row) => row.topicId))].sort(
    (a, b) => Number(a === undefined) - Number(b === undefined),
  );
  return (
    <Flexbox>
      {state.error && (
        <div {...stylex.props(tableStyles.alert)} role={'alert'}>
          <Icon icon={TriangleAlertIcon} size={14} />
          <Flexbox flex={1}>{t('backgroundActivity.unavailable')}</Flexbox>
          <Button
            icon={<Icon icon={RefreshCwIcon} size={12} />}
            size={'small'}
            onClick={() => void refreshActivities()}
          >
            {t('backgroundActivity.retry')}
          </Button>
        </div>
      )}
      {state.activities.length === 0 ? (
        !state.error && (
          <Empty
            description={t('backgroundActivity.emptyDesc')}
            icon={CpuIcon}
            style={{ paddingBlock: 32 }}
            title={t('backgroundActivity.empty')}
          />
        )
      ) : (
        <div {...stylex.props(state.error && tableStyles.stale)}>
          <div {...sx([tableStyles.head], undefined, { gridTemplateColumns: GRID })}>
            <span />
            <span {...stylex.props(tableStyles.headLabel)}>
              {t('backgroundActivity.title')} · {state.activities.length}
            </span>
            <span />
            <span {...stylex.props(tableStyles.headNum)}>{t('backgroundActivity.memory')}</span>
            <span {...stylex.props(tableStyles.headNum)}>{t('backgroundActivity.cpu')}</span>
            <span />
          </div>
          {groups.map((group) => (
            <div key={group ?? 'shared'}>
              <div {...stylex.props(tableStyles.group)}>
                <Icon icon={group ? MessageSquareIcon : CpuIcon} size={13} />
                {group ? <TopicTitle id={group} /> : t('backgroundActivity.shared')}
              </div>
              {state.activities
                .filter((row) => row.topicId === group)
                .map((activity) => (
                  <ActivityRows
                    activity={activity}
                    key={activity.rootId}
                    selected={state.selected === activity.rootId}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
    </Flexbox>
  );
}
