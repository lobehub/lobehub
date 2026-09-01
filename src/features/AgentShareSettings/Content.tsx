'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Alert, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import LimitsSection from './LimitsSection';
import LinkSection from './LinkSection';
import PermissionsSection from './PermissionsSection';
import ToolsSection from './ToolsSection';
import UsageSection from './UsageSection';
import { type AgentShareConfigPatch, useAgentShare } from './useAgentShare';

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
      ) : isLoading && !share ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          <LinkSection
            share={share}
            onDisable={disable}
            onEnable={enable}
            onUpdateSlug={updateSlug}
          />
          {/* Turning sharing off keeps the row (and its config) so the link can
              be resumed unchanged — but while it is off there is no audience to
              configure, so only the on/off + link section stays. */}
          {share?.visibility === 'link' && (
            <>
              <UsageSection agentId={agentId} />
              <PermissionsSection shareConfig={share.shareConfig} onChange={handleConfigChange} />
              <ToolsSection
                agentId={agentId}
                shareConfig={share.shareConfig}
                onChange={handleConfigChange}
              />
              <LimitsSection shareConfig={share.shareConfig} onChange={handleConfigChange} />
            </>
          )}
        </>
      )}
    </Flexbox>
  );
});

AgentShareSettingsContent.displayName = 'AgentShareSettingsContent';

export default AgentShareSettingsContent;
