'use client';

import { Button } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { customAlphabet } from 'nanoid/non-secure';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { chatGroupService } from '@/services/chatGroup';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentGroupStore } from '@/store/agentGroup';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  buttonGroup: css`
    width: 100%;
  `,
}));

/**
 * Generate a market identifier (8-character lowercase alphanumeric string)
 */
const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

const ForkGroupAndChat = memo<{ mobile?: boolean }>(() => {
  const {
    avatar,
    backgroundColor,
    description,
    tags,
    title,
    config,
    identifier,
    memberAgents = [],
  } = useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const { message } = App.useApp();
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

  const handleForkAndChat = async () => {
    try {
      setIsLoading(true);

      // Step 1: Check if user has already forked this group
      const existingGroupId = await chatGroupService.getGroupByForkedFromIdentifier(identifier!);

      if (existingGroupId) {
        // User has already forked this group, navigate to existing fork
        message.info(t('fork.alreadyForked'));
        navigate(urlJoin('/group', existingGroupId));
        return;
      }

      if (!config) {
        message.error(
          t('groupAgents.noConfig', { defaultValue: 'Group configuration not available' }),
        );
        return;
      }

      // Generate a unique identifier for the forked group
      const newIdentifier = generateMarketIdentifier();

      // Step 2: Fork the group via Market API
      const forkResult = await marketApiService.forkAgentGroup(identifier!, {
        identifier: newIdentifier,
        name: title,
        status: 'published',
        visibility: 'public',
      });

      // Step 3: Find supervisor from memberAgents
      const supervisorMember = memberAgents.find((member: any) => {
        const agent = member.agent || member;
        const role = member.role || agent.role;
        return role === 'supervisor';
      });

      // Prepare supervisor config
      let supervisorConfig;
      if (supervisorMember) {
        const member = supervisorMember as any;
        const agent = member.agent || member;
        const currentVersion = member.currentVersion || member;
        const rawConfig = {
          avatar: currentVersion.avatar,
          backgroundColor: currentVersion.backgroundColor,
          chatConfig: currentVersion.config?.chatConfig || currentVersion.chatConfig,
          description: currentVersion.description,
          model: currentVersion.config?.model || currentVersion.model,
          params: currentVersion.config?.params || currentVersion.params,
          plugins: currentVersion.config?.plugins || currentVersion.plugins,
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

      // Step 4: Prepare group config
      const groupConfig = {
        config: {
          ...config,
          forkedFromIdentifier: identifier, // Store the source group identifier
        },
        // Group content is the supervisor's systemRole (for backward compatibility)
        content: config.systemRole || supervisorConfig?.systemRole,
        ...meta,
        // Store marketIdentifier at top-level (same as agents)
        marketIdentifier: forkResult.group.identifier,
      };

      // Step 5: Prepare member agents from market data
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
            chatConfig: currentVersion.config?.chatConfig || currentVersion.chatConfig,
            description: currentVersion.description,
            model: currentVersion.config?.model || currentVersion.model,
            plugins: currentVersion.config?.plugins || currentVersion.plugins,
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

      // Step 6: Create group with all members in one request
      const result = await chatGroupService.createGroupWithMembers(
        groupConfig,
        members,
        supervisorConfig,
      );

      // Refresh group list
      await loadGroups();

      // Step 7: Report fork event (using 'add' event type)
      discoverService.reportAgentEvent({
        event: 'add',
        identifier: forkResult.group.identifier,
        source: location.pathname,
      });

      message.success(t('fork.success'));

      // Step 8: Navigate to chat
      navigate(urlJoin('/group', result.groupId));
    } catch (error: any) {
      console.error('Fork group failed:', error);
      message.error(t('fork.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      block
      className={styles.buttonGroup}
      loading={isLoading}
      size={'large'}
      type={'primary'}
      onClick={handleForkAndChat}
    >
      {t('fork.forkAndChat')}
    </Button>
  );
});

export default ForkGroupAndChat;
