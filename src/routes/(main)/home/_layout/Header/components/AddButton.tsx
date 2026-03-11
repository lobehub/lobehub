import { ActionIcon, DropdownMenu, Flexbox } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useCreateMenuItems } from '../../hooks';

const AddButton = memo(() => {
  const { t: tChat } = useTranslation('chat');

  // Create menu items
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPageMenuItem,
    createAgent,
    isMutatingAgent,
    isCreatingGroup,
  } = useCreateMenuItems();

  const handleMainIconClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      createAgent();
    },
    [createAgent],
  );

  const dropdownItems = useMemo(() => {
    return [createAgentMenuItem(), createGroupChatMenuItem(), createPageMenuItem()];
  }, [createAgentMenuItem, createGroupChatMenuItem, createPageMenuItem]);

  return (
    <Flexbox horizontal>
      <ActionIcon
        icon={CreateBotIcon}
        loading={isMutatingAgent || isCreatingGroup}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={tChat('newAgent')}
        onClick={handleMainIconClick}
      />
      <DropdownMenu items={dropdownItems}>
        <ActionIcon
          color={cssVar.colorTextQuaternary}
          icon={ChevronDownIcon}
          size={{ blockSize: 32, size: 14 }}
          style={{
            width: 16,
          }}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

export default AddButton;
