import type { CollapseProps } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { SessionDefaultGroup } from '@/types/session';

import CollapseGroup from './CollapseGroup';
import Actions from './CollapseGroup/Actions';
import Inbox from './Inbox';
import AgentList from './List';
import ConfigGroupModal from './Modals/ConfigGroupModal';
import RenameGroupModal from './Modals/RenameGroupModal';

const DefaultMode = memo(() => {
  const { t } = useTranslation('chat');

  const [activeGroupId, setActiveGroupId] = useState<string>();
  const [renameGroupModalOpen, setRenameGroupModalOpen] = useState(false);
  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);

  useFetchAgentList();

  const defaultAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const customAgentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);

  const visiblePinnedAgents = useMemo(
    () => pinnedAgents.filter((item) => item.type === 'agent'),
    [pinnedAgents],
  );
  const visibleDefaultAgents = useMemo(
    () => defaultAgents.filter((item) => item.type === 'agent'),
    [defaultAgents],
  );
  const visibleCustomAgentGroups = useMemo(
    () =>
      customAgentGroups.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.type === 'agent'),
      })),
    [customAgentGroups],
  );

  const [sessionGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sessionGroupKeys(s),
    s.updateSystemStatus,
  ]);

  const items = useMemo(
    () =>
      [
        visiblePinnedAgents.length > 0 && {
          children: <AgentList dataSource={visiblePinnedAgents} />,
          extra: <Actions isPinned openConfigModal={() => setConfigGroupModalOpen(true)} />,
          key: SessionDefaultGroup.Pinned,
          label: t('pin'),
        },
        ...visibleCustomAgentGroups.map(({ id, name, items }) => ({
          children: <AgentList dataSource={items} groupId={id} />,
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
          children: <AgentList dataSource={visibleDefaultAgents} />,
          extra: <Actions openConfigModal={() => setConfigGroupModalOpen(true)} />,
          key: SessionDefaultGroup.Default,
          label: t('defaultList'),
        },
      ].filter(Boolean) as CollapseProps['items'],
    [t, visibleCustomAgentGroups, visiblePinnedAgents, visibleDefaultAgents],
  );

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

DefaultMode.displayName = 'AgentDefaultMode';

export default DefaultMode;
