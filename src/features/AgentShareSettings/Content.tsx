'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { AgentShareSettingsBodySkeleton } from '@/components/Skeleton/AgentShare';

import LimitsSection from './LimitsSection';
import LinkSection from './LinkSection';
import PermissionsSection from './PermissionsSection';
import ToolsSection from './ToolsSection';
import UsageSection from './UsageSection';
import { type AgentShareConfigPatch, useAgentShare } from './useAgentShare';
import { useAgentShareSupported } from './useAgentShareSupported';

interface AgentShareSettingsContentProps {
  agentId: string;
}

/**
 * Creator-side share settings for one agent, the body of `/agent/:aid/share`.
 * Every control saves immediately; the server merges each config patch
 * atomically, so a failed write leaves the other fields untouched.
 */
const AgentShareSettingsContent = memo<AgentShareSettingsContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');
  const { disable, enable, error, isLoading, mutate, share, updateConfig, updateSlug } =
    useAgentShare(agentId);
  const { publishable } = useAgentShareSupported(agentId);

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
      {/* Sharing grants real execution on the creator's account — say so plainly. */}
      <Alert
        showIcon
        description={t('share.settings.notice.desc')}
        title={t('share.settings.notice.title')}
        type={'warning'}
      />
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
              <UsageSection
                agentId={agentId}
                monthlySpendLimit={share.shareConfig.monthlySpendLimit}
              />
              <PermissionsSection shareConfig={share.shareConfig} onChange={handleConfigChange} />
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
          )}
        </>
      )}
    </Flexbox>
  );
});

AgentShareSettingsContent.displayName = 'AgentShareSettingsContent';

export default AgentShareSettingsContent;
