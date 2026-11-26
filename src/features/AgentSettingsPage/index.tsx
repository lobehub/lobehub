'use client';

import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import { AgentSettingsProvider } from '@/features/AgentSetting/AgentSettingsProvider';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useAgentSettingsPage } from './useAgentSettingsPage';

const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { agentId, canEdit, config, meta, updateConfig, updateMeta } = useAgentSettingsPage();

  return (
    <AgentSettingsProvider
      config={config}
      disabled={!canEdit}
      id={agentId}
      loading={false}
      meta={meta}
      onConfigChange={updateConfig}
      onMetaChange={updateMeta}
    >
      {children}
    </AgentSettingsProvider>
  );
};

interface AgentSettingsPageProps {
  children: ReactNode;
  title: string;
}

/** Shell for a profile-group page whose body edits the agent through the settings store. */
const AgentSettingsPage = ({ children, title }: AgentSettingsPageProps) => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // Data-presence loading stays true on failure, so read the recorded fetch
  // error too; otherwise a failed config load would show an empty form.
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const configError = useAgentStore(agentSelectors.currentAgentConfigError);
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={activeAgentId ? <AgentBreadcrumb agentId={activeAgentId} title={title} /> : null}
        styles={{ left: { paddingInlineStart: 24 } }}
      />
      <Flexbox flex={1} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
        <WideScreenContainer>
          <Flexbox paddingBlock={16}>
            <AsyncBoundary
              data={isAgentConfigLoading ? undefined : true}
              error={configError}
              errorVariant={'page'}
              isLoading={isAgentConfigLoading && !configError}
              loading={<SurfaceSkeleton header={false} variant={'form'} />}
              onRetry={() => retryAgentConfigFetch()}
            >
              <SettingsProvider>{children}</SettingsProvider>
            </AsyncBoundary>
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

export default AgentSettingsPage;
