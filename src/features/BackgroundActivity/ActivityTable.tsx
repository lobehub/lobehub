import { Empty, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronRightIcon,
  CpuIcon,
  MessageSquareIcon,
  MessageSquareShareIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

import { AgentName } from './AgentName';
import {
  type Activity,
  activityLocation,
  formatCpu,
  formatMemory,
  groupByConversation,
  processTree,
  refreshActivities,
  useActivities,
} from './state';
import StopButton from './StopButton';
import { useWorkspaceSlugOf } from './useWorkspaceSlugOf';

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

const GRID = '16px minmax(0, 1fr) 88px 72px 56px 52px';

const tableStyles = createStaticStyles(({ css }) => ({
  alert: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  actions: css`
    display: flex;
    gap: 2px;
    justify-content: flex-end;
  `,
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
    transition: transform 0.15s ease;
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  conversation: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  critical: css`
    color: ${cssVar.colorError};
  `,
  ellipsis: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  group: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 30px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgLayout};
  `,
  head: css`
    display: grid;
    gap: 8px;
    align-items: center;

    height: 28px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  headLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
  `,
  headNum: css`
    text-align: end;
  `,
  label: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  num: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  proc: css`
    display: grid;
    gap: 8px;
    align-items: center;

    height: 26px;
    padding-inline: 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11.5px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  procName: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    cursor: pointer;

    display: grid;
    gap: 8px;
    align-items: center;

    height: 36px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  selected: css`
    background: ${cssVar.colorFillSecondary};
  `,
  stale: css`
    opacity: 0.55;
  `,
  separator: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  warning: css`
    color: ${cssVar.colorWarning};
  `,
}));

/** "Agent / Topic" — tells the user which conversation a background process belongs to. */
export function ConversationTitle({ agentId, topicId }: { agentId?: string; topicId: string }) {
  if (!agentId) return <TopicTitle id={topicId} />;
  return (
    <span className={tableStyles.conversation}>
      <AgentName id={agentId} />
      <span className={tableStyles.separator}>/</span>
      <span className={tableStyles.ellipsis}>
        <TopicTitle id={topicId} />
      </span>
    </span>
  );
}

/** Topic title for a background activity; fetches the topic when it isn't cached yet. */
export const useTopicTitle = (id?: string) => {
  const title = useChatStore(() => topicName(id));
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  useFetchTopicDetail(title ? undefined : id);
  return title;
};

export function TopicTitle({ id }: { id: string }) {
  const { t } = useTranslation('chat');
  return useTopicTitle(id) || t('backgroundActivity.topic');
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
  const navigate = useWorkspaceAwareNavigate();
  const slugOf = useWorkspaceSlugOf();
  const location = activityLocation(activity, slugOf);
  const alert = activity.severity !== 'normal';
  const tone = activity.severity === 'critical' ? tableStyles.critical : tableStyles.warning;
  return (
    <>
      <div
        aria-expanded={open}
        className={cx(tableStyles.row, selected && tableStyles.selected)}
        ref={ref}
        role={'button'}
        style={{ gridTemplateColumns: GRID }}
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
          className={cx(tableStyles.chevron, open && tableStyles.chevronOpen)}
          icon={ChevronRightIcon}
          size={14}
        />
        <span className={tableStyles.label} title={activity.label}>
          {alert && <Icon className={tone} icon={TriangleAlertIcon} size={14} />}
          {activity.label}
        </span>
        <span className={tableStyles.num}>
          {t('backgroundActivity.processCount', { count: activity.processes.length })}
        </span>
        <span className={cx(tableStyles.num, alert && tone)}>
          {formatMemory(activity.memoryMB)}
        </span>
        <span className={tableStyles.num}>{formatCpu(activity.cpuPercent)}</span>
        <span className={tableStyles.actions}>
          {location && (
            <ActionIcon
              icon={MessageSquareShareIcon}
              size={'small'}
              title={t('backgroundActivity.openMessage')}
              onClick={(event) => {
                event.stopPropagation();
                navigate(location.href, { escape: true });
              }}
            />
          )}
          <StopButton rootId={activity.rootId} />
        </span>
      </div>
      {open &&
        processTree(activity.processes).map(({ depth, row }) => (
          <div className={tableStyles.proc} key={row.id} style={{ gridTemplateColumns: GRID }}>
            <span />
            <span className={tableStyles.procName} style={{ paddingInlineStart: depth * 14 }}>
              {depth > 0 && '└ '}
              {row.name}
            </span>
            <span className={tableStyles.num}>{row.pid}</span>
            <span className={tableStyles.num}>{formatMemory(row.memoryMB)}</span>
            <span className={tableStyles.num}>{formatCpu(row.cpuPercent)}</span>
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
  const conversations = groupByConversation(state.activities);
  return (
    <Flexbox>
      {state.error && (
        <div className={tableStyles.alert} role={'alert'}>
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
        <div className={cx(state.error && tableStyles.stale)}>
          <div className={tableStyles.head} style={{ gridTemplateColumns: GRID }}>
            <span />
            <span className={tableStyles.headLabel}>
              {t('backgroundActivity.title')} · {state.activities.length}
            </span>
            <span />
            <span className={tableStyles.headNum}>{t('backgroundActivity.memory')}</span>
            <span className={tableStyles.headNum}>{t('backgroundActivity.cpu')}</span>
            <span />
          </div>
          {conversations.map(({ activities, agentId, key, topicId }) => {
            return (
              <div key={key}>
                <div className={tableStyles.group}>
                  {topicId ? (
                    <>
                      {!agentId && <Icon icon={MessageSquareIcon} size={13} />}
                      <ConversationTitle agentId={agentId} topicId={topicId} />
                    </>
                  ) : (
                    <>
                      <Icon icon={CpuIcon} size={13} />
                      {t('backgroundActivity.shared')}
                    </>
                  )}
                </div>
                {activities.map((activity) => (
                  <ActivityRows
                    activity={activity}
                    key={activity.rootId}
                    selected={state.selected === activity.rootId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Flexbox>
  );
}
