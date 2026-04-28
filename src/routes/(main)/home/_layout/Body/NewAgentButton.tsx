'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';

import { useCreateMenuItems } from '../hooks';

const NewAgentButton = memo(() => {
  const { t } = useTranslation('chat');
  const { createAgentMenuItem, createGroupChatMenuItem, isMutatingAgent, openCreateModal } =
    useCreateMenuItems();

  const dropdownItems = useMemo(
    () => [createAgentMenuItem(), createGroupChatMenuItem()],
    [createAgentMenuItem, createGroupChatMenuItem],
  );

  return (
    <NavItem
      icon={CreateBotIcon}
      loading={isMutatingAgent}
      title={t('newAgent')}
      actions={
        <DropdownMenu items={dropdownItems} nativeButton={false}>
          <ActionIcon
            color={cssVar.colorTextQuaternary}
            icon={ChevronDownIcon}
            size={'small'}
            style={{ flex: 'none' }}
          />
        </DropdownMenu>
      }
      onClick={() => openCreateModal?.('agent')}
    />
  );
});

export default NewAgentButton;
