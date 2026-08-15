'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeftIcon } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isDesktop } from '@/const/version';
import AgentDocumentsGroup from '@/features/Conversation/WorkingSidebar/ResourcesSection/AgentDocumentsGroup';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  backLink: css`
    display: flex;
    gap: 2px;
    align-items: center;

    width: fit-content;
    padding-block: 3px;
    padding-inline: 4px 6px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    background: transparent;

    transition:
      color 150ms ease,
      background 150ms ease;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
}));

const AgentDocumentSidebarContent = memo(() => {
  const { t } = useTranslation('chat');
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { aid: agentId = '' } = useActiveRouteParams<{
    aid?: string;
  }>();
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const agentTitle = agentDisplayName(agentMeta, t('untitledAgent'));
  const agentPath = buildWorkspaceAwarePath(`/agent/${agentId}`, activeWorkspaceSlug);
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

  const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;

    event.preventDefault();
    appNavigate(agentPath, { escape: true });
  };

  const header = (
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      justify={'space-between'}
      padding={'8px 6px'}
    >
      <a className={styles.backLink} href={agentPath} onClick={handleBack}>
        <Icon icon={ChevronLeftIcon} size={14} />
        {t('agentDocument.backToAgent', { name: agentTitle })}
      </a>
      <ToggleLeftPanelButton />
    </Flexbox>
  );

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
