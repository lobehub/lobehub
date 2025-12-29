import { ActionIcon, Flexbox } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { Dropdown } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useAgentModal } from '../../Body/Agent/ModalProvider';
import { useCreateMenuItems } from '../../hooks';

const AddButton = memo(() => {
  const { t: tChat } = useTranslation('chat');

  const { openGroupWizardModal, closeGroupWizardModal, setGroupWizardLoading } = useAgentModal();

  // Create menu items
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPageMenuItem,
    createAgent,
    createGroupFromTemplate,
    createGroupWithMembers,
    isValidatingAgent,
    isCreatingGroup,
  } = useCreateMenuItems();

  const handleOpenGroupWizard = useCallback(() => {
    openGroupWizardModal({
      onCancel: closeGroupWizardModal,
      onCreateCustom: async (selectedAgents, hostConfig, enableSupervisor) => {
        await createGroupWithMembers(
          selectedAgents,
          tChat('defaultGroupChat'),
          hostConfig,
          enableSupervisor,
        );
        closeGroupWizardModal();
      },
      onCreateFromTemplate: async (
        templateId,
        hostConfig,
        enableSupervisor,
        selectedMemberTitles,
      ) => {
        setGroupWizardLoading(true);
        try {
          await createGroupFromTemplate(
            templateId,
            hostConfig,
            enableSupervisor,
            selectedMemberTitles,
          );
          closeGroupWizardModal();
        } finally {
          setGroupWizardLoading(false);
        }
      },
    });
  }, [
    openGroupWizardModal,
    closeGroupWizardModal,
    createGroupWithMembers,
    createGroupFromTemplate,
    setGroupWizardLoading,
    tChat,
  ]);

  const handleMainIconClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      createAgent();
    },
    [createAgent],
  );

  const dropdownItems = useMemo(() => {
    return [
      createAgentMenuItem(),
      createGroupChatMenuItem(handleOpenGroupWizard),
      createPageMenuItem(),
    ];
  }, [createAgentMenuItem, createGroupChatMenuItem, createPageMenuItem, handleOpenGroupWizard]);

  return (
    <Flexbox horizontal>
      <ActionIcon
        icon={CreateBotIcon}
        loading={isValidatingAgent || isCreatingGroup}
        onClick={handleMainIconClick}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={tChat('newAgent')}
      />
      <Dropdown menu={{ items: dropdownItems || [] }}>
        <ActionIcon
          color={cssVar.colorTextQuaternary}
          icon={ChevronDownIcon}
          size={{ blockSize: 32, size: 14 }}
          style={{
            width: 16,
          }}
        />
      </Dropdown>
    </Flexbox>
  );
});

export default AddButton;
