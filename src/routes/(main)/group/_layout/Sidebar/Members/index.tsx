'use client';

import { AccordionItem, ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Loader2Icon, UserPlus } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import GroupMember from '../GroupConfig/GroupMember';

interface MembersProps {
  itemKey: string;
}

const Members = memo<MembersProps>(({ itemKey }) => {
  const { t } = useTranslation('chat');
  const [addModalOpen, setAddModalOpen] = useState(false);

  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const membersCount = useAgentGroupStore(
    agentGroupSelectors.getGroupAgentCount(activeGroupId || ''),
  );
  const { isRevalidating } = useInitGroupConfig();

  const handleAddMember = (e: MouseEvent) => {
    e.stopPropagation();
    setAddModalOpen(true);
  };

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      action={
        <>
          {isRevalidating && <ActionIcon loading icon={Loader2Icon} size={'small'} />}
          <ActionIcon
            icon={UserPlus}
            size={'small'}
            title={t('groupSidebar.members.addMember')}
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
    </AccordionItem>
  );
});

export default Members;
