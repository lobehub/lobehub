'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Crown, Users } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddGroupMemberModal from '@/app/[variants]/(main)/group/_layout/Sidebar/AddGroupMemberModal';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import AgentBuilderToggle from './AgentBuilderToggle';
import { type ChromeTabItem } from './ChromeTabs';
import ChromeTabs from './ChromeTabs';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    overflow: hidden;
    flex: none;

    width: 100%;
    height: 44px;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tabsWrapper: css`
    scrollbar-width: none;
    overflow-x: auto;
    flex: 1;
    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const Header = memo(() => {
  const { t } = useTranslation('chat');

  const [showAddModal, setShowAddModal] = useState(false);

  const members = useAgentGroupStore(agentGroupSelectors.currentGroupAgents);
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);
  const showLeftPanel = useGlobalStore(systemStatusSelectors.showLeftPanel);

  // Use URL query param for selected tab
  const [selectedTabId, setSelectedTabId] = useQueryState(
    'tab',
    parseAsString.withDefault('group'),
  );

  const existingMemberIds = useMemo(() => members.map((a) => a.id), [members]);

  const tabItems = useMemo<ChromeTabItem[]>(() => {
    const items: ChromeTabItem[] = [
      {
        icon: <Users size={16} />,
        id: 'group',
        title: t('group.profile.groupSettings'),
      },
    ];

    // Add agent tabs
    for (const agent of members) {
      items.push({
        avatar: agent.isSupervisor ? undefined : agent.avatar || undefined,
        icon: agent.isSupervisor ? <Crown size={16} /> : undefined,
        id: agent.id,
        isExternal: !agent.isSupervisor && !agent.virtual,
        title: agent.isSupervisor ? t('group.profile.supervisor') : agent.title || 'Untitled Agent',
      });
    }

    return items;
  }, [members, t]);

  const handleAddMembers = async (agentIds: string[]) => {
    if (!activeGroupId) return;
    await addAgentsToGroup(activeGroupId, agentIds);
    setShowAddModal(false);
  };

  return (
    <>
      <Flexbox horizontal align="center" className={styles.header} gap={4} justify="space-between">
        {!showLeftPanel && <ToggleLeftPanelButton />}
        <div className={styles.tabsWrapper}>
          <ChromeTabs
            activeId={selectedTabId}
            items={tabItems}
            onAdd={() => setShowAddModal(true)}
            onChange={setSelectedTabId}
          />
        </div>
        <Flexbox horizontal align="center" flex="none" gap={8} style={{ marginInlineStart: 12 }}>
          <AgentBuilderToggle />
        </Flexbox>
      </Flexbox>
      {activeGroupId && (
        <AddGroupMemberModal
          existingMembers={existingMemberIds}
          groupId={activeGroupId}
          open={showAddModal}
          onCancel={() => setShowAddModal(false)}
          onConfirm={handleAddMembers}
        />
      )}
    </>
  );
});

export default Header;
