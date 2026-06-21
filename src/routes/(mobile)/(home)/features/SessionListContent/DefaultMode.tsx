import { type CollapseProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchSessions } from '@/hooks/useFetchSessions';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { SessionDefaultGroup } from '@/types/session';

import CollapseGroup from './CollapseGroup';
import Actions from './CollapseGroup/Actions';
import { filterSessionsForView, getRecentChatSessions } from './helpers';
import Inbox from './Inbox';
import SessionList from './List';
import MobileAgentDirectory from './MobileAgentDirectory';
import ConfigGroupModal from './Modals/ConfigGroupModal';
import RenameGroupModal from './Modals/RenameGroupModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  recentChats: css`
    padding-block: 4px 8px;
  `,
  recentChatsTitle: css`
    padding-block: 8px 6px;
    padding-inline: 16px;

    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextDescription};
  `,
}));

const DefaultMode = memo(() => {
  const { t } = useTranslation('chat');

  const [activeGroupId, setActiveGroupId] = useState<string>();
  const [renameGroupModalOpen, setRenameGroupModalOpen] = useState(false);
  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);

  useFetchSessions();

  const isMobile = useServerConfigStore(serverConfigSelectors.isMobile);

  const defaultSessions = useSessionStore(sessionSelectors.defaultSessions, isEqual);
  const customSessionGroups = useSessionStore(sessionSelectors.customSessionGroups, isEqual);
  const pinnedSessions = useSessionStore(sessionSelectors.pinnedSessions, isEqual);

  const filteredDefaultSessions = filterSessionsForView(defaultSessions, isMobile);
  const filteredPinnedSessions = filterSessionsForView(pinnedSessions, isMobile);
  const filteredCustomSessionGroups = customSessionGroups?.map((group) => ({
    ...group,
    children: filterSessionsForView(group.children, isMobile),
  }));

  const recentChatSessions = useMemo(
    () =>
      getRecentChatSessions({
        customSessionGroups,
        defaultSessions,
        isMobile,
        pinnedSessions,
      }),
    [customSessionGroups, defaultSessions, isMobile, pinnedSessions],
  );
  const shouldShowRecentChats = recentChatSessions.length > 0;

  const [sessionGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sessionGroupKeys(s),
    s.updateSystemStatus,
  ]);

  const items = useMemo(
    () =>
      [
        filteredPinnedSessions &&
          filteredPinnedSessions.length > 0 && {
            children: <SessionList dataSource={filteredPinnedSessions} />,
            extra: <Actions isPinned openConfigModal={() => setConfigGroupModalOpen(true)} />,
            key: SessionDefaultGroup.Pinned,
            label: t('pin'),
          },
        ...(filteredCustomSessionGroups || []).map(({ id, name, children }) => ({
          children: <SessionList dataSource={children} groupId={id} />,
          extra: (
            <Actions
              isCustomGroup
              id={id}
              openConfigModal={() => setConfigGroupModalOpen(true)}
              openRenameModal={() => setRenameGroupModalOpen(true)}
              onOpenChange={(isOpen) => {
                if (isOpen) setActiveGroupId(id);
              }}
            />
          ),
          key: id,
          label: name,
        })),
        {
          children: <SessionList dataSource={filteredDefaultSessions || []} />,
          extra: <Actions openConfigModal={() => setConfigGroupModalOpen(true)} />,
          key: SessionDefaultGroup.Default,
          label: t('defaultList'),
        },
      ].filter(Boolean) as CollapseProps['items'],
    [t, filteredCustomSessionGroups, filteredPinnedSessions, filteredDefaultSessions],
  );

  const visibleSessionIds = useMemo(
    () => [
      ...filteredDefaultSessions.map((session) => session.id),
      ...filteredPinnedSessions.map((session) => session.id),
      ...(filteredCustomSessionGroups ?? []).flatMap((group) =>
        group.children.map((session) => session.id),
      ),
    ],
    [filteredCustomSessionGroups, filteredDefaultSessions, filteredPinnedSessions],
  );

  return (
    <>
      <Inbox />
      {shouldShowRecentChats && (
        <section className={styles.recentChats}>
          <div className={styles.recentChatsTitle}>{t('recentChats')}</div>
          <SessionList dataSource={recentChatSessions} showAddButton={false} />
        </section>
      )}
      {isMobile && <MobileAgentDirectory existingSessionIds={visibleSessionIds} />}
      <CollapseGroup
        activeKey={sessionGroupKeys}
        items={items}
        onChange={(keys) => {
          const expandSessionGroupKeys = typeof keys === 'string' ? [keys] : keys;
          updateSystemStatus({ expandSessionGroupKeys });
        }}
      />
      {activeGroupId && (
        <RenameGroupModal
          id={activeGroupId}
          open={renameGroupModalOpen}
          onCancel={() => setRenameGroupModalOpen(false)}
        />
      )}
      <ConfigGroupModal
        open={configGroupModalOpen}
        onCancel={() => setConfigGroupModalOpen(false)}
      />
    </>
  );
});

DefaultMode.displayName = 'SessionDefaultMode';

export default DefaultMode;
