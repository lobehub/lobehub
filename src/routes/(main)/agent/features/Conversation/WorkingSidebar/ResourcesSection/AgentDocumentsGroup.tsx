import { Accordion, AccordionItem, ActionIcon, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { LucideIcon } from 'lucide-react';
import { FileTextIcon, GlobeIcon, Trash2Icon } from 'lucide-react';
import type { CSSProperties, MouseEvent } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { DocumentExplorerTree } from '@/features/AgentDocumentsExplorer';
import SkillsList, { type SkillListItem } from '@/features/AgentDocumentsExplorer/SkillsList';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import ProjectLevelSkills from './ProjectLevelSkills';

const AGENT_SKILLS_ITEM_KEY = 'agent-skills';

const PAGE_ROUTE_PATTERN = '/agent/:aid/:topicId/page/:docId?';

dayjs.extend(relativeTime);

type ResourceFilter = 'skills' | 'documents' | 'web';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  containerActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  pillActive: css`
    font-weight: 500;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  pillTab: css`
    cursor: pointer;
    user-select: none;

    padding-block: 4px;
    padding-inline: 12px;
    border-radius: 999px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition:
      background ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut},
      color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  sectionCount: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  sectionEmpty: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 500;
  `,
  title: css`
    font-weight: 500;
  `,
}));

const FILTER_OPTIONS = [
  { labelKey: 'workingPanel.resources.filter.skills', value: 'skills' },
  { labelKey: 'workingPanel.resources.filter.documents', value: 'documents' },
  { labelKey: 'workingPanel.resources.filter.web', value: 'web' },
] as const satisfies readonly { labelKey: string; value: ResourceFilter }[];

type AgentDocumentListItem = Awaited<ReturnType<typeof agentDocumentService.getDocuments>>[number];

interface DocumentItemProps {
  agentId: string;
  document: AgentDocumentListItem;
  hideDelete?: boolean;
  mutate: () => Promise<unknown>;
}

const DocumentItem = memo<DocumentItemProps>(
  ({ agentId, document, hideDelete = false, mutate }) => {
    const { t } = useTranslation(['chat', 'common']);
    const { message, modal } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const openDocument = useChatStore((s) => s.openDocument);
    const closeDocument = useChatStore((s) => s.closeDocument);
    const portalDocumentId = useChatStore(chatPortalSelectors.portalDocumentId);
    const navigate = useNavigate();
    const pageMatch = useMatch(PAGE_ROUTE_PATTERN);

    const title = document.title || document.filename || '';
    const description = document.description ?? undefined;
    const isWeb = document.sourceType === 'web';
    const IconComponent: LucideIcon = isWeb ? GlobeIcon : FileTextIcon;
    const updatedAtLabel = document.updatedAt
      ? t('workingPanel.resources.updatedAt', {
          ns: 'chat',
          time: dayjs(document.updatedAt).fromNow(),
        })
      : null;

    const activeDocumentId = pageMatch ? pageMatch.params.docId : portalDocumentId;
    const isActive = activeDocumentId === document.documentId;

    const handleOpen = () => {
      if (!document.documentId) return;
      if (pageMatch?.params.aid && pageMatch.params.topicId) {
        navigate(
          `/agent/${pageMatch.params.aid}/${pageMatch.params.topicId}/page/${document.documentId}`,
        );
        return;
      }
      openDocument(document.documentId);
    };

    const handleDelete = (e: MouseEvent) => {
      e.stopPropagation();
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        centered: true,
        content: t('workingPanel.resources.deleteConfirm', { ns: 'chat' }),
        okButtonProps: { danger: true, type: 'primary' },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          setDeleting(true);
          try {
            if (isActive) closeDocument();
            await agentDocumentService.removeDocument({
              agentId,
              documentId: document.documentId,
              id: document.id,
              topicId: pageMatch?.params.topicId,
            });
            await mutate();
            message.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
          } catch (error) {
            message.error(
              error instanceof Error
                ? error.message
                : t('workingPanel.resources.deleteError', { ns: 'chat' }),
            );
          } finally {
            setDeleting(false);
          }
        },
        title: t('workingPanel.resources.deleteTitle', { ns: 'chat' }),
      });
    };

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        className={`${styles.container} ${isActive ? styles.containerActive : ''}`}
        gap={8}
        onClick={handleOpen}
      >
        <IconComponent size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Flexbox horizontal align={'center'} distribution={'space-between'}>
            <Text ellipsis className={styles.title}>
              {title}
            </Text>
            {!hideDelete && (
              <ActionIcon
                icon={Trash2Icon}
                loading={deleting}
                size={'small'}
                title={t('delete', { ns: 'common' })}
                onClick={handleDelete}
              />
            )}
          </Flexbox>
          {description && (
            <Text className={styles.description} ellipsis={{ rows: 2 }}>
              {description}
            </Text>
          )}
          {updatedAtLabel && <Text className={styles.meta}>{updatedAtLabel}</Text>}
        </Flexbox>
      </Flexbox>
    );
  },
);

DocumentItem.displayName = 'AgentDocumentsGroupItem';

interface SkillBundleView {
  bundle: AgentDocumentListItem;
  files: string[];
  pathToDocumentId: Map<string, string>;
}

const buildSkillBundleViews = (data: AgentDocumentListItem[]): SkillBundleView[] => {
  const childrenByParent = new Map<string, AgentDocumentListItem[]>();
  for (const doc of data) {
    if (!doc.parentId) continue;
    const list = childrenByParent.get(doc.parentId) ?? [];
    list.push(doc);
    childrenByParent.set(doc.parentId, list);
  }

  return data
    .filter((doc) => doc.isSkillBundle)
    .map((bundle) => {
      const files: string[] = [];
      const pathToDocumentId = new Map<string, string>();

      const walk = (parentDocId: string, prefix: string) => {
        const children = childrenByParent.get(parentDocId) ?? [];
        for (const child of children) {
          const name = child.filename || child.title || 'untitled';
          const relPath = prefix ? `${prefix}/${name}` : name;
          if (child.isFolder) {
            walk(child.documentId, relPath);
          } else {
            files.push(relPath);
            pathToDocumentId.set(relPath, child.documentId);
          }
        }
      };
      walk(bundle.documentId, '');

      return { bundle, files, pathToDocumentId };
    });
};

interface AgentDocumentsGroupProps {
  style?: CSSProperties;
  workingDirectory?: string;
}

const AgentDocumentsGroup = memo<AgentDocumentsGroupProps>(({ style, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const isLocalEnabled = useAgentStore((s) =>
    agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
  );
  const openDocument = useChatStore((s) => s.openDocument);
  const navigate = useNavigate();
  const pageMatch = useMatch(PAGE_ROUTE_PATTERN);
  const [filter, setFilter] = useState<ResourceFilter>('skills');
  const [agentSkillsExpanded, setAgentSkillsExpanded] = useState(true);

  const showProjectSkills = isLocalEnabled && !!workingDirectory;

  const {
    data = [],
    error,
    isLoading,
    mutate,
  } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documentsList(agentId) : null, () =>
    agentDocumentService.getDocuments({ agentId: agentId! }),
  );

  const webData = useMemo(() => data.filter((doc) => doc.category === 'web'), [data]);

  const documentsData = useMemo(() => data.filter((doc) => doc.category === 'document'), [data]);

  const skillBundleViews = useMemo(() => buildSkillBundleViews(data), [data]);

  const skillItems = useMemo<SkillListItem[]>(
    () =>
      skillBundleViews.map(({ bundle, files }) => ({
        description: bundle.description ?? undefined,
        fileCount: files.length,
        files,
        id: bundle.documentId,
        name: bundle.title || bundle.filename || '',
      })),
    [skillBundleViews],
  );

  const openDocumentByRoute = (documentId: string) => {
    if (pageMatch?.params.aid && pageMatch.params.topicId) {
      navigate(`/agent/${pageMatch.params.aid}/${pageMatch.params.topicId}/page/${documentId}`);
      return;
    }
    openDocument(documentId);
  };

  if (!agentId) return null;

  if (isLoading) {
    return (
      <Center flex={1} paddingBlock={24}>
        <NeuralNetworkLoading size={32} />
      </Center>
    );
  }

  if (error) {
    return (
      <Center flex={1} paddingBlock={24}>
        <Text type={'danger'}>{t('workingPanel.resources.error')}</Text>
      </Center>
    );
  }

  const renderAgentSkillsList = () =>
    skillItems.length === 0 ? (
      <Center paddingBlock={8}>
        <Text className={styles.sectionEmpty}>{t('workingPanel.skills.emptyAgent')}</Text>
      </Center>
    ) : (
      <SkillsList
        items={skillItems}
        onOpenFile={(item, relativePath) => {
          const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
          const docId = view?.pathToDocumentId.get(relativePath);
          if (docId) openDocumentByRoute(docId);
        }}
        onOpenSkill={(item) => {
          // Open the SKILL.md (skills/index child) when present; fall back to
          // the bundle itself (orphan bundles surface for recovery).
          const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
          const indexChild = data.find((doc) => doc.parentId === item.id && doc.isSkillIndex);
          openDocumentByRoute(indexChild?.documentId ?? view?.bundle.documentId ?? item.id);
        }}
      />
    );

  const renderAgentSkillsSection = () => (
    <Accordion
      expandedKeys={agentSkillsExpanded ? [AGENT_SKILLS_ITEM_KEY] : []}
      gap={4}
      onExpandedChange={(keys) => setAgentSkillsExpanded(keys.length > 0)}
    >
      <AccordionItem
        itemKey={AGENT_SKILLS_ITEM_KEY}
        paddingBlock={2}
        paddingInline={4}
        title={
          <Flexbox horizontal align={'center'} gap={6}>
            <Text className={styles.sectionLabel} type={'secondary'}>
              {t('workingPanel.skills.section.agent')}
            </Text>
            {skillItems.length > 0 && (
              <span className={styles.sectionCount}>{skillItems.length}</span>
            )}
          </Flexbox>
        }
      >
        {renderAgentSkillsList()}
      </AccordionItem>
    </Accordion>
  );

  const renderSkills = () => {
    // No project section (not local mode / no working dir): show the agent
    // skills flat, without the redundant "Agent skills" group header.
    if (!showProjectSkills) {
      if (skillItems.length === 0) {
        return (
          <Center flex={1} gap={8} paddingBlock={24}>
            <Empty description={t('workingPanel.skills.empty')} icon={SkillsIcon} />
          </Center>
        );
      }
      return renderAgentSkillsList();
    }

    // Both sections coexist — label each so the source is clear.
    return (
      <Flexbox gap={16}>
        {renderAgentSkillsSection()}
        <ProjectLevelSkills workingDirectory={workingDirectory!} />
      </Flexbox>
    );
  };

  const renderDocuments = () => (
    // Always render the tree for the Documents tab even when empty, so the
    // toolbar (new folder / new doc) stays reachable.
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <DocumentExplorerTree
        agentId={agentId}
        data={documentsData}
        mutate={mutate}
        style={{ height: '100%' }}
      />
    </Flexbox>
  );

  const renderWeb = () => {
    if (webData.length === 0) {
      return (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty description={t('workingPanel.resources.empty')} icon={GlobeIcon} />
        </Center>
      );
    }
    return (
      <Flexbox gap={8}>
        {webData.map((doc) => (
          <DocumentItem agentId={agentId} document={doc} key={doc.id} mutate={mutate} />
        ))}
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={12} style={style}>
      <Flexbox horizontal gap={4} role={'tablist'}>
        {FILTER_OPTIONS.map((option) => {
          const active = filter === option.value;
          return (
            <div
              aria-selected={active}
              className={cx(styles.pillTab, active && styles.pillActive)}
              key={option.value}
              role={'tab'}
              onClick={() => setFilter(option.value)}
            >
              {t(option.labelKey)}
            </div>
          );
        })}
      </Flexbox>
      {filter === 'skills' && renderSkills()}
      {filter === 'documents' && renderDocuments()}
      {filter === 'web' && renderWeb()}
    </Flexbox>
  );
});

AgentDocumentsGroup.displayName = 'AgentDocumentsGroup';

export default AgentDocumentsGroup;
