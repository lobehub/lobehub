'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { Alert, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentShareConfigPatchInput } from '@/services/agentShare';

import LimitsSection from './LimitsSection';
import LinkSection from './LinkSection';
import PermissionsSection from './PermissionsSection';
import ToolsSection from './ToolsSection';
import { useAgentShare } from './useAgentShare';

interface AgentShareSettingsContentProps {
  agentId: string;
}

/**
 * Creator-side share settings for one agent. Every control saves immediately;
 * the server merges each config patch atomically, so a failed write leaves the
 * other fields untouched.
 */
const AgentShareSettingsContent = memo<AgentShareSettingsContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');
  const { disable, enable, isLoading, share, updateConfig, updateSlug } = useAgentShare(agentId);

  const handleConfigChange = useCallback(
    async (patch: AgentShareConfigPatchInput) => {
      try {
        await updateConfig(patch);
      } catch {
        toast.error(t('share.settings.updateError'));
      }
    },
    [t, updateConfig],
  );

  return (
    <Flexbox gap={16} padding={20}>
      {/* Sharing grants real execution on the creator's account — say so plainly. */}
      <Alert
        showIcon
        description={t('share.settings.notice.desc')}
        title={t('share.settings.notice.title')}
        type={'warning'}
      />
      {isLoading && !share ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          <LinkSection
            share={share}
            onDisable={disable}
            onEnable={enable}
            onUpdateSlug={updateSlug}
          />
          {share && (
            <>
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
