'use client';

import { AGENT_DOCUMENT_CATEGORY, AGENT_DOCUMENT_SKILL_CATEGORY } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import Agent from '@/features/AgentSidebar/Header/Agent';
import AgentDocumentsGroup from '@/features/Conversation/WorkingSidebar/ResourcesSection/AgentDocumentsGroup';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { standardizeIdentifier } from '@/utils/identifier';

type AgentDocumentPanelTab = 'documents' | 'skills';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex-shrink: 0;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillTertiary};
  `,
  tabs: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
}));

const TABS = [
  { key: 'documents', labelKey: 'workingPanel.resources.filter.documents' },
  { key: 'skills', labelKey: 'workingPanel.skills.title' },
] as const satisfies readonly { key: AgentDocumentPanelTab; labelKey: string }[];

const AgentDocumentSidebarContent = memo(() => {
  const { t } = useTranslation('chat');
  // null = not yet picked by the user → follow the auto default below.
  const [pickedTab, setPickedTab] = useState<AgentDocumentPanelTab | null>(null);
  const { aid: agentId = '', docId } = useActiveRouteParams<{
    aid?: string;
    docId?: string;
  }>();
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

  // Deduped against AgentDocumentsGroup's own fetch (same SWR key). When the
  // agent has no plain documents (e.g. only skills) we default to the Skills
  // tab so the panel doesn't open on an empty Documents view.
  const {
    data: documentList = [],
    error: documentListError,
    isLoading: isDocumentListLoading,
  } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documentsList(agentId) : null, () =>
    agentDocumentService.listDocuments({ agentId }),
  );
  const hasDocuments = useMemo(
    () => documentList.some((doc) => doc.category === AGENT_DOCUMENT_CATEGORY),
    [documentList],
  );
  // The open doc itself decides the default tab: a skill entry (SKILL.md or any
  // file inside a skill bundle) lands on Skills even when normal documents
  // exist — otherwise the skill-entry flow would open on the wrong tab.
  const isSkillEntry = useMemo(
    () =>
      docId
        ? documentList.some(
            (doc) =>
              standardizeIdentifier(doc.documentId) === docId &&
              doc.category === AGENT_DOCUMENT_SKILL_CATEGORY,
          )
        : false,
    [docId, documentList],
  );
  const activeTab: AgentDocumentPanelTab =
    pickedTab ??
    (isSkillEntry || (!documentListError && !isDocumentListLoading && !hasDocuments)
      ? 'skills'
      : 'documents');

  const header = (
    <>
      <SideBarHeaderLayout left={<Agent />} />
      <Flexbox horizontal align={'center'} className={styles.header} height={36} paddingInline={8}>
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
              key={tab.key}
              type="button"
              onClick={() => setPickedTab(tab.key)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </Flexbox>
    </>
  );

  const body = (
    <Flexbox className={styles.body} width={'100%'}>
      <AgentDocumentsGroup
        activeFilter={activeTab}
        deviceId={remoteDeviceId}
        openMode="route"
        showFilterTabs={false}
        showLocalProjectSkills={isDesktop}
        style={{ flex: 1, minHeight: 0 }}
        workingDirectory={workingDirectory}
      />
    </Flexbox>
  );

  return <SideBarLayout body={body} header={header} />;
});

AgentDocumentSidebarContent.displayName = 'AgentDocumentSidebarContent';

export default AgentDocumentSidebarContent;
