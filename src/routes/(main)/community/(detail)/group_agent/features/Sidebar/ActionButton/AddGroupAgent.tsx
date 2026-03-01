'use client';

import { Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { chatGroupService } from '@/services/chatGroup';
import { discoverService } from '@/services/discover';
import { useAgentGroupStore } from '@/store/agentGroup';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  buttonGroup: css`
    width: 100%;
  `,
  menuButton: css`
    padding-inline: 8px;
    border-start-start-radius: 0 !important;
    border-end-start-radius: 0 !important;
  `,
  primaryButton: css`
    border-start-end-radius: 0 !important;
    border-end-end-radius: 0 !important;
  `,
}));

const AddGroupAgent = memo<{ mobile?: boolean }>(() => {
  const {
    avatar,
    description,
    tags,
    title,
    config,
    backgroundColor,
    identifier,
    memberAgents = [],
  } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const { message, modal } = App.useApp();
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  const loadGroups = useAgentGroupStore((s) => s.loadGroups);

  const meta = {
    avatar,
    backgroundColor,
    description,
    tags,
    title,
  };

  // Check if a group with the same title already exists
  const checkDuplicateGroup = async () => {
    if (!title) return false;
    try {
      const groups = await chatGroupService.getGroups();
      return groups.some((g) => g.title === title);
    } catch {
      return false;
    }
  };

  const showDuplicateConfirmation = (callback: () => void) => {
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('groupAgents.duplicateAdd.content', {
        defaultValue: 'This group agent has already been added. Do you want to add it again?',
        title,
      }),
      okText: t('groupAgents.duplicateAdd.ok', { defaultValue: 'Add Anyway' }),
      onOk: callback,
      title: t('groupAgents.duplicateAdd.title', { defaultValue: 'Group Already Added' }),
    });
  };

  const createGroupFromMarket = async (shouldNavigate = true) => {
    if (!config) {
      message.error(
        t('groupAgents.noConfig', { defaultValue: 'Group configuration not available' }),
      );
      return;
    }

    // Find supervisor from memberAgents
    const supervisorMember = memberAgents.find((member: any) => {
      const agent = member.agent || member;
      const role = member.role || agent.role;
      return role === 'supervisor';
    });

    // Prepare supervisor config
    let supervisorConfig;
    if (supervisorMember) {
      // Type assertion needed because actual API data structure differs from type definition
      const member = supervisorMember as any;
      const agent = member.agent || member;
      const currentVersion = member.currentVersion || member;
      const rawConfig = {
        avatar: currentVersion.avatar,
        backgroundColor: currentVersion.backgroundColor,
        description: currentVersion.description,
        model: currentVersion.config?.model || currentVersion.model,
        params: currentVersion.config?.params || currentVersion.params,
        provider: currentVersion.config?.provider || currentVersion.provider,
        systemRole:
          currentVersion.config?.systemRole ||
          currentVersion.config?.systemPrompt ||
          currentVersion.systemRole ||
          currentVersion.content,
        tags: currentVersion.tags,
        title: currentVersion.name || agent.name || 'Supervisor',
      };
      // Filter out null/undefined values
      supervisorConfig = Object.fromEntries(
         
        Object.entries(rawConfig).filter(([_, v]) => v != null),
      );
    }

    // Prepare group config
    const groupConfig = {
      config: {
        allowDM: config.allowDM,
        openingMessage: config.openingMessage,
        openingQuestions: config.openingQuestions,
        revealDM: config.revealDM,
      },
      // Group content is the supervisor's systemRole (for backward compatibility)
      content: supervisorConfig?.systemRole || config.systemRole,
      ...meta,
    };

    // Prepare member agents from market data
    // Filter out supervisor role as it will be created separately using supervisorConfig
    const members = memberAgents
      .filter((member: any) => {
        const agent = member.agent || member;
        const role = member.role || agent.role;
        return role !== 'supervisor';
      })
      .map((member: any) => {
        const agent = member.agent || member;
        const currentVersion = member.currentVersion || member;
        return {
          avatar: currentVersion.avatar,
          backgroundColor: currentVersion.backgroundColor,
          description: currentVersion.description,
          model: currentVersion.config?.model || currentVersion.model,
          plugins: currentVersion.plugins,
          provider: currentVersion.config?.provider || currentVersion.provider,
          systemRole:
            currentVersion.config?.systemRole ||
            currentVersion.config?.systemPrompt ||
            currentVersion.systemRole ||
            currentVersion.content,
          tags: currentVersion.tags,
          title: currentVersion.name || agent.name,
        };
      });

    try {
      // Create group with all members in one request
      const result = await chatGroupService.createGroupWithMembers(
        groupConfig,
        members,
        supervisorConfig,
      );

      // Refresh group list
      await loadGroups();

      // Report installation to marketplace
      if (identifier) {
        discoverService.reportAgentInstall(identifier);
        discoverService.reportAgentEvent({
          event: 'add',
          identifier,
          source: location.pathname,
        });
      }

      message.success(
        t('groupAgents.addSuccess', { defaultValue: 'Group agent added successfully!' }),
      );

      if (shouldNavigate) {
        navigate(urlJoin('/group', result.groupId));
      }

      return result;
    } catch (error) {
      console.error('Failed to create group from market:', error);
      message.error(
        t('groupAgents.addError', {
          defaultValue: 'Failed to add group agent. Please try again.',
        }),
      );
      throw error;
    }
  };

  const handleAddAndConverse = async () => {
    setIsLoading(true);
    try {
      const isDuplicate = await checkDuplicateGroup();
      if (isDuplicate) {
        showDuplicateConfirmation(() => createGroupFromMarket(true));
      } else {
        await createGroupFromMarket(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    setIsLoading(true);
    try {
      const isDuplicate = await checkDuplicateGroup();
      if (isDuplicate) {
        showDuplicateConfirmation(() => createGroupFromMarket(false));
      } else {
        await createGroupFromMarket(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const menuItems = [
    {
      key: 'addGroup',
      label: t('groupAgents.addGroup', { defaultValue: 'Add Group' }),
      onClick: handleAdd,
    },
  ];

  return (
    <Flexbox horizontal className={styles.buttonGroup} gap={0}>
      <Button
        block
        className={styles.primaryButton}
        loading={isLoading}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
        onClick={handleAddAndConverse}
      >
        {t('groupAgents.addAndConverse', { defaultValue: 'Add & Start Conversation' })}
      </Button>
      <DropdownMenu
        items={menuItems}
        popupProps={{ style: { minWidth: 267 } }}
        triggerProps={{ disabled: isLoading }}
      >
        <Button
          className={styles.menuButton}
          disabled={isLoading}
          icon={<Icon icon={ChevronDownIcon} />}
          size={'large'}
          type={'primary'}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

export default AddGroupAgent;
