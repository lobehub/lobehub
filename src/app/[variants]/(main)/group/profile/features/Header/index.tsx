'use client';

import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Crown, Users } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddGroupMemberModal from '@/app/[variants]/(main)/group/_layout/Sidebar/AddGroupMemberModal';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import AgentBuilderToggle from './AgentBuilderToggle';
import ChromeTabs, { type ChromeTabItem } from './ChromeTabs';

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    overflow: hidden;

    flex: none;

    width: 100%;
    height: 44px;
    padding-block: 8px;
    padding-inline: 12px;

    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  tabsWrapper: css`
    overflow-x: auto;
    flex: 1;
    min-width: 0;

    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const { styles } = useStyles();

  const [showAddModal, setShowAddModal] = useState(false);

  const members = useAgentGroupStore(agentGroupSelectors.currentGroupAgents);
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);

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
      <Flexbox align="center" className={styles.header} horizontal justify="space-between">
        <div className={styles.tabsWrapper}>
          <ChromeTabs
            activeId={selectedTabId}
            items={tabItems}
            onAdd={() => setShowAddModal(true)}
            onChange={setSelectedTabId}
          />
        </div>
        <Flexbox align="center" flex="none" gap={8} horizontal style={{ marginInlineStart: 12 }}>
          <AgentBuilderToggle />
        </Flexbox>
      </Flexbox>
      {activeGroupId && (
        <AddGroupMemberModal
          existingMembers={existingMemberIds}
          groupId={activeGroupId}
          onCancel={() => setShowAddModal(false)}
          onConfirm={handleAddMembers}
          open={showAddModal}
        />
      )}
    </>
  );
});

export default Header;
