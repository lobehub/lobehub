import { type CollapseProps } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import CollapseGroup from './CollapseGroup';
import Actions from './CollapseGroup/Actions';
import Inbox from './Inbox';
import AgentList from './List';
import ConfigGroupModal from './Modals/ConfigGroupModal';
import { openRenameGroupModal } from './Modals/RenameGroupModal';

const DefaultMode = memo(() => {
  const { t } = useTranslation('chat');

  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);

  // ALL hooks called unconditionally (Rules of Hooks)
  useFetchAgentList();

  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);

  const activeWorkspaceId = useActiveWorkspaceId();
  const sessionGroupKeys = useGlobalStore(
    systemStatusSelectors.sessionGroupKeys(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const items = useMemo(
    () =>
      [
        pinnedAgents &&
          pinnedAgents.length > 0 && {
            children: <AgentList dataSource={pinnedAgents} />,
            extra: <Actions isPinned openConfigModal={() => setConfigGroupModalOpen(true)} />,
            key: 'pinned',
            label: t('pin'),
          },
        ...agentGroups.map(({ id, name, items: children }) => ({
          children: <AgentList dataSource={children} groupId={id} />,
          extra: (
            <Actions
              isCustomGroup
              id={id}
              openConfigModal={() => setConfigGroupModalOpen(true)}
              openRenameModal={() => openRenameGroupModal(id)}
            />
          ),
          key: id,
          label: name,
        })),
        {
          children: <AgentList dataSource={ungroupedAgents || []} />,
          extra: <Actions openConfigModal={() => setConfigGroupModalOpen(true)} />,
          key: 'default',
          label: t('defaultList'),
        },
      ].filter(Boolean) as CollapseProps['items'],
    [t, agentGroups, pinnedAgents, ungroupedAgents],
  );

  // CRITICAL: defer rendering behind serverConfigInit to prevent antd-style
  // theme engine crash ('.status' TypeError when components mount before init)
  if (!serverConfigInit || !isAgentListInit) {
    return <Inbox />;
  }

  return (
    <>
      <Inbox />
      <CollapseGroup
        activeKey={sessionGroupKeys}
        items={items}
        onChange={(keys) => {
          const expandSessionGroupKeys = typeof keys === 'string' ? [keys] : keys;
          updateSystemStatus({ expandSessionGroupKeys });
        }}
      />
      <ConfigGroupModal
        open={configGroupModalOpen}
        onCancel={() => setConfigGroupModalOpen(false)}
      />
    </>
  );
});

DefaultMode.displayName = 'AgentDefaultMode';

export default DefaultMode;
