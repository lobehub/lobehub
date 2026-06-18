'use client';

import { AGENT_DOCUMENT_CATEGORY, AGENT_DOCUMENT_SKILL_CATEGORY } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import RightPanel from '@/features/RightPanel';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useClientDataSWR } from '@/libs/swr';
import AgentDocumentsGroup from '@/routes/(main)/agent/features/Conversation/WorkingSidebar/ResourcesSection/AgentDocumentsGroup';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
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

const AgentDocumentRightPanel = memo(() => {
  const { t } = useTranslation('chat');
  // null = not yet picked by the user → follow the auto default below.
  const [pickedTab, setPickedTab] = useState<AgentDocumentPanelTab | null>(null);
  const { docId } = useParams<{ docId?: string }>();
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);
  const agencyConfig = useAgentStore((s) =>
    activeAgentId ? agentByIdSelectors.getAgencyConfigById(activeAgentId)(s) : undefined,
  );
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    isDesktop,
    isHetero,
  });
  const remoteDeviceId =
    effectiveTarget === 'device' && agencyConfig?.boundDeviceId
      ? agencyConfig.boundDeviceId
      : undefined;

  // Deduped against AgentDocumentsGroup's own fetch (same SWR key). When the
  // agent has no plain documents (e.g. only skills) we default to the Skills
  // tab so the panel doesn't open on an empty Documents view.
  const { data: documentList = [], isLoading: isDocumentListLoading } = useClientDataSWR(
    activeAgentId ? agentDocumentSWRKeys.documentsList(activeAgentId) : null,
    () => agentDocumentService.listDocuments({ agentId: activeAgentId! }),
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
    (isSkillEntry || (!isDocumentListLoading && !hasDocuments) ? 'skills' : 'documents');

  return (
    <RightPanel stableLayout defaultWidth={360} maxWidth={720} minWidth={300}>
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          height={44}
          justify={'space-between'}
          paddingInline={4}
        >
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
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
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
      </Flexbox>
    </RightPanel>
  );
});

AgentDocumentRightPanel.displayName = 'AgentDocumentRightPanel';

export default AgentDocumentRightPanel;
