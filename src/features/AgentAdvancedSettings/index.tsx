'use client';

import { Flexbox, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentGraphRuntime from '@/features/AgentSetting/AgentGraphRuntime';
import AgentOpening from '@/features/AgentSetting/AgentOpening';
import { AgentSettingsProvider } from '@/features/AgentSetting/AgentSettingsProvider';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useAgentAdvancedSettings } from './useAgentAdvancedSettings';

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={8}>
    <Text as={'h2'} fontSize={16} style={{ margin: 0 }} weight={600}>
      {title}
    </Text>
    {children}
  </Flexbox>
);

const AdvancedSettingsSections = () => {
  const { t } = useTranslation('setting');
  const { agentId, canEdit, config, meta, showGraph, updateConfig, updateMeta } =
    useAgentAdvancedSettings();

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
      <Flexbox gap={32}>
        <Section title={t('agentTab.opening')}>
          <AgentOpening />
        </Section>
        {showGraph && (
          <Section title={t('agentTab.graph')}>
            <AgentGraphRuntime />
          </Section>
        )}
      </Flexbox>
    </AgentSettingsProvider>
  );
};

const AgentAdvancedSettings = () => {
  const { t } = useTranslation('setting');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // Data-presence loading stays true on failure, so read the recorded fetch
  // error too; otherwise a failed config load would show an empty form.
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const configError = useAgentStore(agentSelectors.currentAgentConfigError);
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb agentId={activeAgentId} title={t('advancedSettings')} />
          ) : null
        }
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
              <AdvancedSettingsSections />
            </AsyncBoundary>
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

export default AgentAdvancedSettings;
