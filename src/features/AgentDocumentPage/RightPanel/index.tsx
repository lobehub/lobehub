'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import AgentDocumentsGroup from '@/features/Conversation/WorkingSidebar/ResourcesSection/AgentDocumentsGroup';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
}));

const AgentDocumentSidebarContent = memo(() => {
  const { t } = useTranslation('chat');
  const { aid: agentId = '' } = useActiveRouteParams<{
    aid?: string;
  }>();
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const agentTitle = agentDisplayName(agentMeta, t('untitledAgent'));
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const workingDirectory = useEffectiveWorkingDirectory(agentId);
  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const isWorkspaceAgent = useAgentStore((s) =>
    agentId ? agentByIdSelectors.isWorkspaceAgentById(agentId)(s) : false,
  );
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped: isWorkspaceAgent,
  });
  const remoteDeviceId =
    effectiveTarget === 'device' && agencyConfig?.boundDeviceId
      ? agencyConfig.boundDeviceId
      : undefined;

  const header = <SideBarHeaderLayout backTo={`/agent/${agentId}`} left={agentTitle} />;

  const body = (
    <Flexbox className={styles.body} width={'100%'}>
      <AgentDocumentsGroup
        activeFilter="documents"
        deviceId={remoteDeviceId}
        openMode="route"
        showFilterTabs={false}
        showLocalProjectSkills={false}
        style={{ flex: 1, minHeight: 0 }}
        workingDirectory={workingDirectory}
      />
    </Flexbox>
  );

  return <SideBarLayout body={body} header={header} />;
});

AgentDocumentSidebarContent.displayName = 'AgentDocumentSidebarContent';

export default AgentDocumentSidebarContent;
