'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AgentShareSpendDetail from '@/business/client/features/AgentShareSpendDetail';
import AsyncError from '@/components/AsyncError';
import { AgentShareSettingsBodySkeleton } from '@/components/Skeleton/AgentShare';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import LimitsSection from './LimitsSection';
import LinkSection from './LinkSection';
import PermissionsSection from './PermissionsSection';
import ShareTabs from './ShareTabs';
import ToolsSection from './ToolsSection';
import UsageSection from './UsageSection';
import { type AgentShareConfigPatch, useAgentShare } from './useAgentShare';
import { useAgentShareSupported } from './useAgentShareSupported';
import { useShareSettingsTab } from './useShareSettingsTab';

/**
 * `dismissedBannerIds` entry for the "visitors run on your account" notice.
 * Dismissal is per device (global store, persisted): the notice is a one-time
 * briefing, not a per-agent warning, so it stays away for every agent once
 * the owner has read it.
 */
const NOTICE_DISMISS_ID = 'agent-share-visitor-runs-notice';

interface AgentShareSettingsContentProps {
  agentId: string;
}

/**
 * Creator-side share settings for one agent, the body of `/agent/:aid/share`.
 * Every control saves immediately; the server merges each config patch
 * atomically, so a failed write leaves the other fields untouched.
 *
 * Layout: the link card (master switch + url) always sits on top, then two
 * tabs split what the owner GRANTS (permissions, tools, limits) from what the
 * share has DONE (usage roll-up and, on deployments that meter it, the
 * per-call spend detail).
 */
const AgentShareSettingsContent = memo<AgentShareSettingsContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');
  const { disable, enable, error, isLoading, mutate, share, updateConfig, updateSlug } =
    useAgentShare(agentId);
  const { publishable } = useAgentShareSupported(agentId);
  const [tab, setTab] = useShareSettingsTab();

  const noticeDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(NOTICE_DISMISS_ID),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const dismissNotice = useCallback(() => {
    const current = useGlobalStore.getState().status.dismissedBannerIds || [];
    if (current.includes(NOTICE_DISMISS_ID)) return;
    updateSystemStatus({ dismissedBannerIds: [...current, NOTICE_DISMISS_ID] });
  }, [updateSystemStatus]);

  const handleConfigChange = useCallback(
    async (patch: AgentShareConfigPatch) => {
      try {
        await updateConfig(patch);
      } catch {
        toast.error(t('share.settings.updateError'));
      }
    },
    [t, updateConfig],
  );

  // Same skeleton as the route-level one so the page does not reflow between
  // the chunk load and the share fetch.
  if (isLoading && !share && !error) return <AgentShareSettingsBodySkeleton />;

  return (
    <Flexbox gap={16} paddingBlock={16}>
      {/* Sharing grants real execution on the creator's account — say so plainly,
          once: the owner can dismiss it after reading. */}
      {!noticeDismissed && (
        <Alert
          showIcon
          closable={{ onClose: dismissNotice }}
          description={t('share.settings.notice.desc')}
          title={t('share.settings.notice.title')}
          type={'warning'}
        />
      )}
      {error && !share ? (
        <AsyncError error={error} variant={'block'} onRetry={() => void mutate()} />
      ) : (
        <>
          <LinkSection
            publishable={publishable}
            share={share}
            onDisable={disable}
            onEnable={enable}
            onUpdateSlug={updateSlug}
          />
          {/* Turning sharing off keeps the row (and its config) so the SAME link
              resumes on re-enable. The config stays editable while paused on
              purpose: re-enabling republishes whatever grants/limits are stored
              at that instant, so an owner must be able to tighten them BEFORE
              existing link holders regain access. */}
          {share && (
            <>
              <ShareTabs active={tab} onChange={setTab} />
              {tab === 'access' ? (
                <>
                  <PermissionsSection
                    shareConfig={share.shareConfig}
                    onChange={handleConfigChange}
                  />
                  <ToolsSection
                    agentId={agentId}
                    shareConfig={share.shareConfig}
                    onChange={handleConfigChange}
                  />
                  <LimitsSection
                    agentId={agentId}
                    shareConfig={share.shareConfig}
                    onChange={handleConfigChange}
                  />
                </>
              ) : (
                <>
                  <UsageSection
                    agentId={agentId}
                    monthlySpendLimit={share.shareConfig.monthlySpendLimit}
                  />
                  {/* Business slot: the per-call spend table. Renders nothing on
                      deployments that do not meter share spend. */}
                  <AgentShareSpendDetail agentId={agentId} />
                </>
              )}
            </>
          )}
        </>
      )}
    </Flexbox>
  );
});

AgentShareSettingsContent.displayName = 'AgentShareSettingsContent';

export default AgentShareSettingsContent;
