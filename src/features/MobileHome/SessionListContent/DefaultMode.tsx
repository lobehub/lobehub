import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  useAgentList,
  useKeepSidebarListed,
} from '@/features/HomeSidebar/Body/Agent/List/useAgentList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { SessionDefaultGroup } from '@/types/session';

import CollapseGroup, { type CollapseGroupItem } from './CollapseGroup';
import Actions from './CollapseGroup/Actions';
import Inbox from './Inbox';
import SessionList from './List';
import ConfigGroupModal from './Modals/ConfigGroupModal';
import { openRenameGroupModal } from './Modals/RenameGroupModal';

const DefaultMode = memo(() => {
  const { t } = useTranslation('chat');

  const [configGroupModal, setConfigGroupModal] = useState<{
    open: boolean;
    scope: 'private' | 'public';
  }>({ open: false, scope: 'public' });

  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchAgentList = useHomeStore((s) => s.useFetchAgentList);
  useFetchAgentList(isLogin);
  const { defaultList, pinnedList, customList, privateGroupList, privateUngroupedList } =
    useAgentList(false);
  const keep = useKeepSidebarListed();
  const privatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const filteredDefaultSessions = [...defaultList, ...privateUngroupedList];
  const filteredPinnedSessions = [...pinnedList, ...keep(privatePinned)];
  const filteredCustomSessionGroups = [
    ...customList,
    ...privateGroupList.map((group) => ({ ...group, visibility: 'private' as const })),
  ].map((group) => ({
    ...group,
    children: group.items,
  }));

  const activeWorkspaceId = useActiveWorkspaceId();
  const sessionGroupKeys = useGlobalStore(
    systemStatusSelectors.sessionGroupKeys(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const items = [
    filteredPinnedSessions &&
      filteredPinnedSessions.length > 0 && {
        children: <SessionList dataSource={filteredPinnedSessions} />,
        extra: (
          <Actions
            isPinned
            openConfigModal={() => setConfigGroupModal({ open: true, scope: 'public' })}
          />
        ),
        key: SessionDefaultGroup.Pinned,
        label: t('pin'),
      },
    ...(filteredCustomSessionGroups || []).map(({ id, name, children, visibility }) => ({
      children: <SessionList dataSource={children} groupId={id} visibility={visibility} />,
      extra: (
        <Actions
          isCustomGroup
          id={id}
          openConfigModal={() => setConfigGroupModal({ open: true, scope: visibility ?? 'public' })}
          openRenameModal={() => openRenameGroupModal(id)}
          visibility={visibility}
        />
      ),
      key: id,
      label: name,
    })),
    {
      children: <SessionList dataSource={filteredDefaultSessions || []} groupId={null} />,
      extra: (
        <Actions openConfigModal={() => setConfigGroupModal({ open: true, scope: 'public' })} />
      ),
      key: SessionDefaultGroup.Default,
      label: t('defaultList'),
    },
  ].filter(Boolean) as CollapseGroupItem[];

  return (
    <>
      <Inbox />
      <CollapseGroup
        activeKey={sessionGroupKeys}
        items={items}
        onChange={(expandSessionGroupKeys) => updateSystemStatus({ expandSessionGroupKeys })}
      />
      <ConfigGroupModal
        open={configGroupModal.open}
        scope={configGroupModal.scope}
        onCancel={() => setConfigGroupModal((state) => ({ ...state, open: false }))}
      />
    </>
  );
});

DefaultMode.displayName = 'SessionDefaultMode';

export default DefaultMode;
