import { Button, Flexbox } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncBoundary from '@/components/AsyncBoundary';
import {
  AgentChannelDetailBodySkeleton,
  AgentChannelListBodySkeleton,
} from '@/components/Skeleton/AgentChannel';
import PlatformDetail from '@/features/AgentChannel/PlatformDetail';
import ComingSoonDetail from '@/features/AgentChannel/PlatformDetail/ComingSoon';
import PlatformGrid from '@/features/AgentChannel/PlatformGrid';
import { useAgentChannels } from '@/features/AgentChannel/useAgentChannels';

interface ChannelSettingsProps {
  agentId: string;
  disabled: boolean;
  onSelectPlatform: (platform: string | undefined) => void;
  platform?: string;
}

/**
 * The coordinator's IM connections (Telegram, Discord, Feishu, Slack, …),
 * keyed by the agent the project resolves. Credentials stay on their own
 * encrypting `agentBotProvider` routes, so the agent channel components are
 * reused as they are rather than copied into the project patch.
 */
export const CoordinatorChannelSettings = ({
  agentId,
  disabled,
  onSelectPlatform,
  platform,
}: ChannelSettingsProps) => {
  // The platform cards read the `agent` namespace, which the project settings
  // have not loaded yet; wait for it rather than flash raw keys.
  const { t, ready } = useTranslation(['project', 'agent'], { useSuspense: false });
  const {
    allPlatforms,
    error,
    hasData,
    isLoading,
    platformRuntimeStatuses,
    platforms,
    providers,
    retry,
  } = useAgentChannels(agentId, !disabled);

  const activePlatformDef = useMemo(
    () => (platform ? allPlatforms.find((item) => item.id === platform) : undefined),
    [allPlatforms, platform],
  );
  const currentConfig = useMemo(
    () => providers?.find((item) => item.platform === platform),
    [platform, providers],
  );

  if (!ready)
    return platform ? <AgentChannelDetailBodySkeleton /> : <AgentChannelListBodySkeleton />;

  return (
    <Flexbox gap={12}>
      {platform && (
        <Flexbox horizontal>
          <Button icon={ChevronLeftIcon} type="text" onClick={() => onSelectPlatform(undefined)}>
            {t('coordinator.channel.back')}
          </Button>
        </Flexbox>
      )}
      <AsyncBoundary
        data={hasData ? platforms : undefined}
        error={error}
        errorVariant={'block'}
        isLoading={isLoading}
        loading={platform ? <AgentChannelDetailBodySkeleton /> : <AgentChannelListBodySkeleton />}
        onRetry={retry}
      >
        {!platform ? (
          <PlatformGrid
            agentId={agentId}
            platforms={allPlatforms}
            runtimeStatuses={platformRuntimeStatuses}
            onSelect={onSelectPlatform}
          />
        ) : activePlatformDef ? (
          activePlatformDef.comingSoon ? (
            <ComingSoonDetail platformDef={activePlatformDef} />
          ) : (
            <PlatformDetail
              agentId={agentId}
              currentConfig={currentConfig}
              disabled={disabled}
              platformDef={activePlatformDef}
            />
          )
        ) : (
          <NotFound />
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};
