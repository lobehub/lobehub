'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { customAlphabet } from 'nanoid/non-secure';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { chatGroupService } from '@/services/chatGroup';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentGroupStore } from '@/store/agentGroup';

import {
  isMarketOrgSetupRequiredError,
  promptMarketOrgSetup,
} from '../../../../../utils/marketOrgSetup';
import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  buttonGroup: css`
    width: 100%;
  `,
  forkButton: css`
    flex: 1;
    width: unset;
    border-start-start-radius: 0 !important;
    border-end-start-radius: 0 !important;
  `,
  // Match Button type="primary" on the right so the two halves read as one
  // pill. (colorPrimary bg + colorBgLayout text) auto-flips with the theme:
  // dark bg + near-white text in light theme, white bg + near-black text
  // in dark theme. We use colorBgLayout directly instead of the
  // semantically-named colorTextLightSolid because the cssVar proxy doesn't
  // pick up LobeHub's JS-level override of that token.
  visibilitySelect: css`
    width: 130px;
    border-color: ${cssVar.colorPrimary} !important;
    border-inline-end-width: 0 !important;
    border-start-end-radius: 0 !important;
    border-end-end-radius: 0 !important;

    color: ${cssVar.colorBgLayout} !important;

    background: ${cssVar.colorPrimary} !important;

    & svg {
      color: ${cssVar.colorBgLayout};
    }

    &:hover:not([data-disabled]) {
      border-color: ${cssVar.colorPrimaryHover} !important;
      background: ${cssVar.colorPrimaryHover} !important;
    }

    &:active:not([data-disabled]) {
      border-color: ${cssVar.colorPrimaryActive} !important;
      background: ${cssVar.colorPrimaryActive} !important;
    }
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

type ForkTarget = 'private' | 'public';

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
  const navigate = useWorkspaceAwareNavigate();
  const loadGroups = useAgentGroupStore((s) => s.loadGroups);
  const { isAuthenticated, signIn } = useMarketAuth();
  const { allowed: canCreate } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const activeWorkspace = useActiveWorkspace();
  const isWorkspaceOwner = activeWorkspace?.role === 'owner';
  const [visibility, setVisibility] = useState<ForkTarget>('private');

  const meta = {
    avatar,
    backgroundColor,
    description,
    tags,
    title,
  };

  const handleForkAndChat = async (target: ForkTarget = 'private') => {
    if (!canCreate || isLoading) return;
    // Check if user is authenticated
    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
    }

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

      // Same rationale as ForkAndChat.tsx — workspace forks must carry an
      // org `actAs` so Market accepts the request; the local chat group
      // still lands in the user's Private bucket via `visibility: 'private'`
      // on the groupConfig below. When the workspace has no Community
      // profile yet we prompt the user (role-aware) and abort the fork.
      let actAs: number | undefined;
      if (activeWorkspaceId) {
        try {
          const { marketAccountId } =
            await lambdaClient.workspace.ensureMarketOrganization.mutate();
          actAs = marketAccountId;
        } catch (error) {
          if (isMarketOrgSetupRequiredError(error)) {
            promptMarketOrgSetup({
              isOwner: isWorkspaceOwner,
              onSetup: () => navigate('/community/workspace'),
            });
            return;
          }
          throw error;
        }
      }

      // Step 2: Fork the group via Market API
      const forkResult = await marketApiService.forkAgentGroup(identifier!, {
        actAs,
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

      // Step 4: Prepare group config. `target` decides where the chat
      // group lands in the sidebar: Private (only the creator sees it) or
      // workspace-shared. In personal mode visibility is left unset so the
      // column default (`public`) applies harmlessly.
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
        ...(activeWorkspaceId ? { visibility: target } : {}),
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

  // Personal mode: plain primary button, no Private/Public choice to make.
  if (!activeWorkspaceId) {
    return (
      <Button
        block
        className={styles.buttonGroup}
        disabled={!canCreate}
        loading={isLoading}
        size={'large'}
        type={'primary'}
        onClick={() => handleForkAndChat('private')}
      >
        {t('fork.forkAndChat')}
      </Button>
    );
  }

  // Workspace mode: Select on the left chooses Private (default) vs Public,
  // primary button on the right runs the fork. Mirrors ForkAndChat.tsx so
  // both flows look and behave the same way.
  const visibilityOptions = [
    { label: t('fork.visibilityPrivate'), value: 'private' },
    { label: t('fork.visibilityPublic'), value: 'public' },
  ];

  return (
    <Flexbox horizontal className={styles.buttonGroup} gap={0}>
      <Select
        className={styles.visibilitySelect}
        disabled={!canCreate || isLoading}
        options={visibilityOptions}
        size={'large'}
        value={visibility}
        onChange={(v) => setVisibility(v as ForkTarget)}
      />
      <Button
        block
        className={styles.forkButton}
        disabled={!canCreate}
        loading={isLoading}
        size={'large'}
        type={'primary'}
        onClick={() => handleForkAndChat(visibility)}
      >
        {t('fork.forkAndChat')}
      </Button>
    </Flexbox>
  );
});

export default ForkGroupAndChat;
