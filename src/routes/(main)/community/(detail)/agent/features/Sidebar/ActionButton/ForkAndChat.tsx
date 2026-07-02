'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { customAlphabet } from 'nanoid/non-secure';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

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

const ForkAndChat = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { identifier, title, config, avatar, backgroundColor, description, tags, editorData } =
    useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');
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
    marketIdentifier: identifier,
    tags,
    title,
  };

  // `target` only matters in workspace mode. Personal-mode forks ignore it
  // (every row there is implicitly owner-private). Default = Private so
  // newly-grabbed agents don't surface to teammates before the user has
  // had a chance to vet them.
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

      // Step 1: Check if user has already forked this agent
      const existingAgentId = await agentService.getAgentByForkedFromIdentifier(identifier!);

      if (existingAgentId) {
        // User has already forked this agent, navigate to existing fork
        message.info(t('fork.alreadyForked'));
        navigate(AGENT_CHAT_URL(existingAgentId, mobile));
        return;
      }

      // Generate a unique identifier for the forked agent
      const newIdentifier = generateMarketIdentifier();

      // Workspace mode forks must be attributed to the workspace's Market
      // organization mirror — the per-user trust token always carries the
      // workspaceId, so Market rejects the request without
      // `x-lobe-owner-account-id` (403). Whether the local agent ends up
      // private or public is independent of this market-side ownership.
      //
      // When the workspace has no Community profile yet we abort and prompt
      // the user. Owners get a deep-link CTA; everyone else is asked to
      // contact the owner.
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

      // Step 2: Fork the agent via Market API (single-item batch)
      const [forkOutcome] = await marketApiService.forkAgent([
        {
          actAs,
          identifier: newIdentifier,
          name: title,
          sourceIdentifier: identifier!,
          status: 'published',
          visibility: 'public',
        },
      ]);

      if (!forkOutcome.success) {
        throw new Error(forkOutcome.error?.message || 'Forking failed');
      }

      const forkResult = forkOutcome.data;

      // Step 3: Create agent config with forked data
      if (!config) throw new Error('Agent config is missing');

      const agentData = {
        config: {
          ...config,
          editorData,
          ...meta,
          marketIdentifier: forkResult.agent.identifier,
          params: {
            ...config.params,
            forkedFromIdentifier: identifier, // Store the source agent identifier
          },
          title: forkResult.agent.name,
        },
      };

      // Step 4: Add to local agent list. `target` decides where it lands —
      // Private bucket (only the creator sees it) or workspace-shared
      // (visible to every member). In personal mode `visibility` is left
      // unset and the column defaults to `public` (no-op).
      const result = await createAgent({
        ...agentData,
        ...(activeWorkspaceId ? { visibility: target } : {}),
      });
      await refreshAgentList();

      // Step 5: Report fork event (using 'add' event type)
      discoverService.reportAgentEvent({
        event: 'add',
        identifier: forkResult.agent.identifier,
        source: location.pathname,
      });

      message.success(t('fork.success'));

      // Step 6: Navigate to chat
      navigate(AGENT_CHAT_URL(result!.agentId, mobile));
    } catch (error: any) {
      console.error('Fork failed:', error);
      message.error(t('fork.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Personal mode has no Private/Public split — render the plain primary
  // button so users don't see a meaningless dropdown.
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
  // primary button on the right runs the fork. Keeping the choice next to
  // the action makes the target visibility explicit at click time.
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

export default ForkAndChat;
