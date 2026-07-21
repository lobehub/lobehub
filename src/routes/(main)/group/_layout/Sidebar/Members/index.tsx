'use client';

import { AccordionItem, ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { ArrowUpDown, Loader2Icon, UserPlus } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import { usePermission } from '@/hooks/usePermission';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import GroupMember from '../GroupConfig/GroupMember';
import SortMembersModal from '../GroupConfig/SortMembersModal';

interface MembersProps {
  itemKey: string;
}

const Members = memo<MembersProps>(({ itemKey }) => {
  const { t } = useTranslation('chat');
  const { allowed: hasEditPermission, reason } = usePermission('edit_own_content');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);

  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const { canEditResource } = useResourceAccess('agentGroup', activeGroupId);
  const canEdit = hasEditPermission && canEditResource;
  const membersCount = useAgentGroupStore(
    agentGroupSelectors.getGroupAgentCount(activeGroupId || ''),
  );
  const memberCount = useAgentGroupStore(
    agentGroupSelectors.getGroupMemberCount(activeGroupId || ''),
  );
  const { isRevalidating } = useInitGroupConfig();

  const handleAddMember = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;

    setAddModalOpen(true);
  };

  const handleSortMember = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;

    setSortModalOpen(true);
  };

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      action={
        <>
          {isRevalidating && <ActionIcon loading icon={Loader2Icon} size={'small'} />}
          {memberCount > 1 && (
            <ActionIcon
              disabled={!canEdit}
              icon={ArrowUpDown}
              size={'small'}
              title={canEdit ? t('groupSidebar.members.sortMember') : reason}
              onClick={handleSortMember}
            />
          )}
          <ActionIcon
            disabled={!canEdit}
            icon={UserPlus}
            size={'small'}
            title={canEdit ? t('groupSidebar.members.addMember') : reason}
            onClick={handleAddMember}
          />
        </>
      }
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {`${t('groupSidebar.tabs.members')} ${membersCount}`}
        </Text>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        <GroupMember
          addModalOpen={addModalOpen}
          groupId={activeGroupId}
          onAddModalOpenChange={setAddModalOpen}
        />
      </Flexbox>
      {activeGroupId && (
        <SortMembersModal
          groupId={activeGroupId}
          open={sortModalOpen}
          onCancel={() => setSortModalOpen(false)}
        />
      )}
    </AccordionItem>
  );
});

export default Members;
