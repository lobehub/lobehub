'use client';

import { Center, Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  ActivityIcon,
  AlertCircleIcon,
  HammerIcon,
  HistoryIcon,
  MessageSquareIcon,
  TerminalSquareIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import ListSkeleton from '@/components/ListSkeleton';
import { formatSize } from '@/utils/format';

import { type SandboxSessionRecord, useInstanceSessions } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /** The same frame the instance list uses, so the two tabs read as one panel. */
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  row: css`
    padding-block: 12px;
    padding-inline: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  /**
   * The run that is going on now, framed apart from the trail below it the way
   * Railway frames the active deployment, with a footer line that says what is
   * happening rather than what happened. The frame stays neutral — a solid
   * info tint reads as a heavy navy block in dark mode — and only the footer's
   * status line carries the info color.
   */
  active: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  activeFooter: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    color: ${cssVar.colorInfo};
  `,
  historyLabel: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  kindIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 50%;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

/** How long the run lasted, or how long it has been running. */
const duration = (session: SandboxSessionRecord): string => {
  const end = session.endedAt ? dayjs(session.endedAt) : dayjs();
  const minutes = Math.max(1, Math.round(end.diff(session.startedAt, 'minute', true)));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
};

const SessionRow = memo<{ session: SandboxSessionRecord }>(({ session }) => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();

  const isBuild = session.kind === 'build';
  const running = !session.endedAt;
  // Three kinds of run, told apart by how they were started: a build from
  // the environment's specification, a console session from the file
  // browser, or a conversation — the common case, named by its topic.
  const title = isBuild
    ? t('environments.sessions.kind.build')
    : session.management
      ? t('environments.sessions.kind.console')
      : session.topicTitle || t('environments.sessions.kind.conversation');
  const icon = isBuild ? HammerIcon : session.management ? TerminalSquareIcon : MessageSquareIcon;

  // A build's verdict is its outcome; a session's reason is why it stopped,
  // and the snapshot beside it says whether what it did was kept.
  const outcome = running ? (
    <Tag color={'processing'} size={'small'}>
      {t('environments.sessions.running')}
    </Tag>
  ) : session.endReason?.startsWith('build_') ? (
    <Tag color={session.endReason === 'build_succeeded' ? 'success' : 'error'} size={'small'}>
      {t(`environments.sessions.reason.${session.endReason}` as any)}
    </Tag>
  ) : (
    <Text fontSize={12} type={'secondary'}>
      {t(`environments.sessions.reason.${session.endReason ?? 'lost'}` as any)}
    </Text>
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={12}>
      <span className={styles.kindIcon}>
        <Icon icon={icon} size={14} />
      </span>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={13} weight={500}>
          {title}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {session.instanceName}
          {' · '}
          <Tooltip title={new Date(session.startedAt).toLocaleString()}>
            <span>{dayjs(session.startedAt).fromNow()}</span>
          </Tooltip>
          {' · '}
          {duration(session)}
        </Text>
      </Flexbox>
      {/* Snapshot outcome: only a stopped session has one, and a failed one
          is the single thing on this row the person can act on. */}
      {!isBuild && !running && session.snapshotError && (
        <Tooltip title={session.snapshotError}>
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon icon={AlertCircleIcon} size={14} style={{ color: cssVar.colorError }} />
            <Text fontSize={12} type={'danger'}>
              {t('environments.sessions.snapshotFailed')}
            </Text>
          </Flexbox>
        </Tooltip>
      )}
      {!isBuild && !running && !session.snapshotError && session.snapshotBytes !== null && (
        <Text fontSize={12} type={'secondary'}>
          {t('environments.sessions.snapshotSaved', { size: formatSize(session.snapshotBytes) })}
        </Text>
      )}
      {/* Railway's "View logs" on the active deployment: the one thing to do
          with a run in progress is go to it. Only a conversation has somewhere
          to go; a build and a console session have no page of their own. */}
      {running && session.topicId && !session.management && (
        <Button size={'small'} onClick={() => navigate(`/chat?topic=${session.topicId}`)}>
          {t('environments.sessions.openConversation')}
        </Button>
      )}
      {outcome}
    </Flexbox>
  );
});

SessionRow.displayName = 'SessionRow';

/**
 * What has run in an environment: every session and every build of each of
 * its instances, newest first. Read from the control plane's own trail, so
 * it opens without waiting on a sandbox — and it stays readable in an
 * environment someone else published, since seeing what ran is not an edit.
 */
/**
 * Drop the session row a build rode in on.
 *
 * A build is written to the trail twice: once when its sandbox starts, as a
 * management session, and once when the build itself does. They are the same
 * machine — same `sessionId` — but the list showed them as two runs side by
 * side, the first of them labelled "file browser", which is a thing nobody
 * did. The build row is the better of the two anyway: it carries the outcome
 * and the log.
 *
 * Only a management row is ever dropped, and only when a build in the same
 * list names its session. A console session opened by the file browser has no
 * build beside it and stays.
 */
export const withoutBuildVehicles = (sessions: SandboxSessionRecord[]): SandboxSessionRecord[] => {
  const builds = new Set(
    sessions.filter((session) => session.kind === 'build').map((session) => session.sessionId),
  );
  if (builds.size === 0) return sessions;

  return sessions.filter(
    (session) => session.kind === 'build' || !session.management || !builds.has(session.sessionId),
  );
};

const SessionHistorySection = memo<{ environmentId: string }>(({ environmentId }) => {
  const { t } = useTranslation('setting');
  const { data, isLoading } = useInstanceSessions(environmentId);

  if (isLoading && !data) return <ListSkeleton />;

  const sessions = withoutBuildVehicles(data?.sessions ?? []);
  const active = sessions.filter((session) => !session.endedAt);
  const history = sessions.filter((session) => session.endedAt);

  return (
    <Flexbox gap={16}>
      {data?.unavailable && (
        <Text fontSize={12} type={'warning'}>
          {t('environments.sessions.unavailable')}
        </Text>
      )}

      {active.length > 0 && (
        <Flexbox gap={8}>
          {active.map((session) => (
            <div className={styles.active} key={`${session.kind}-${session.id}`}>
              <SessionRow session={session} />
              <Flexbox horizontal align={'center'} className={styles.activeFooter} gap={8}>
                <Icon icon={ActivityIcon} size={14} />
                <Text fontSize={12} style={{ color: 'inherit' }}>
                  {t(
                    session.kind === 'build'
                      ? 'environments.sessions.activeBuild'
                      : 'environments.sessions.activeSession',
                    { instance: session.instanceName },
                  )}
                </Text>
              </Flexbox>
            </div>
          ))}
        </Flexbox>
      )}

      {sessions.length === 0 ? (
        <Center paddingBlock={16}>
          <Empty
            description={t('environments.sessions.emptyHint')}
            descriptionProps={{ fontSize: 13 }}
            icon={HistoryIcon}
            style={{ maxWidth: 360 }}
            title={t('environments.sessions.empty')}
          />
        </Center>
      ) : (
        <Flexbox gap={8}>
          {/* Labelled only once there is something above it to be "history"
              relative to; alone, the list is the whole tab. */}
          {active.length > 0 && (
            <span className={styles.historyLabel}>{t('environments.sessions.history')}</span>
          )}
          {history.length === 0 ? (
            <Text fontSize={12} type={'secondary'}>
              {t('environments.sessions.historyEmpty')}
            </Text>
          ) : (
            <div className={styles.list}>
              {history.map((session) => (
                <SessionRow key={`${session.kind}-${session.id}`} session={session} />
              ))}
            </div>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

SessionHistorySection.displayName = 'SessionHistorySection';

export default SessionHistorySection;
