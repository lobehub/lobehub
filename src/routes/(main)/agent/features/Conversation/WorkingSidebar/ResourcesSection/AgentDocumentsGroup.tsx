import { ActionIcon, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { App, Spin } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { FileTextIcon, GlobeIcon, type LucideIcon, Trash2Icon } from 'lucide-react';
import { memo, type MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';

import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const PAGE_ROUTE_PATTERN = '/agent/:aid/:topicId/page/:docId?';

dayjs.extend(relativeTime);

type ResourceFilter = 'all' | 'documents' | 'web';

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
  groupLabel: css`
    padding-inline: 4px;

    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
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
  title: css`
    font-weight: 500;
  `,
}));

const FILTER_OPTIONS = [
  { labelKey: 'workingPanel.resources.filter.all', value: 'all' },
  { labelKey: 'workingPanel.resources.filter.documents', value: 'documents' },
  { labelKey: 'workingPanel.resources.filter.web', value: 'web' },
] as const satisfies readonly { labelKey: string; value: ResourceFilter }[];

type AgentDocumentListItem = Awaited<ReturnType<typeof agentDocumentService.getDocuments>>[number];

interface DocumentItemProps {
  agentId: string;
  document: AgentDocumentListItem;
  mutate: () => Promise<unknown>;
}

const DocumentItem = memo<DocumentItemProps>(({ agentId, document, mutate }) => {
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
  const createdAtLabel = document.createdAt ? dayjs(document.createdAt).fromNow() : null;

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
      centered: true,
      okButtonProps: { danger: true },
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
          <ActionIcon
            icon={Trash2Icon}
            loading={deleting}
            size={'small'}
            title={t('delete', { ns: 'common' })}
            onClick={handleDelete}
          />
        </Flexbox>
        {description && (
          <Text className={styles.description} ellipsis={{ rows: 2 }}>
            {description}
          </Text>
        )}
        {createdAtLabel && <Text className={styles.meta}>{createdAtLabel}</Text>}
      </Flexbox>
    </Flexbox>
  );
});

DocumentItem.displayName = 'AgentDocumentsGroupItem';

interface AgentDocumentsGroupProps {
  viewMode?: 'list' | 'tree';
}

const AgentDocumentsGroup = memo<AgentDocumentsGroupProps>(({ viewMode = 'list' }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const [filter, setFilter] = useState<ResourceFilter>('all');

  const {
    data = [],
    error,
    isLoading,
    mutate,
  } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documentsList(agentId) : null, () =>
    agentDocumentService.getDocuments({ agentId: agentId! }),
  );

  const filteredData = useMemo(() => {
    if (filter === 'documents') return data.filter((doc) => doc.sourceType !== 'web');
    if (filter === 'web') return data.filter((doc) => doc.sourceType === 'web');
    return data;
  }, [data, filter]);

  const treeGroups = useMemo(() => {
    const docs = data.filter((doc) => doc.sourceType !== 'web');
    const webs = data.filter((doc) => doc.sourceType === 'web');
    return (
      [
        { items: docs, labelKey: 'workingPanel.resources.filter.documents' },
        { items: webs, labelKey: 'workingPanel.resources.filter.web' },
      ] as const
    ).filter((group) => group.items.length > 0);
  }, [data]);

  if (!agentId) return null;

  if (isLoading) {
    return (
      <Center flex={1} paddingBlock={24}>
        <Spin />
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

  if (data.length === 0) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('workingPanel.resources.empty')} icon={FileTextIcon} />
      </Center>
    );
  }

  if (viewMode === 'tree') {
    return (
      <Flexbox gap={16}>
        {treeGroups.map((group) => (
          <Flexbox gap={8} key={group.labelKey}>
            <Text className={styles.groupLabel} type={'secondary'}>
              {t(group.labelKey)}
            </Text>
            <Flexbox gap={8}>
              {group.items.map((doc) => (
                <DocumentItem agentId={agentId} document={doc} key={doc.id} mutate={mutate} />
              ))}
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12}>
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
      {filteredData.length === 0 ? (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty
            description={t('workingPanel.resources.empty')}
            icon={filter === 'web' ? GlobeIcon : FileTextIcon}
          />
        </Center>
      ) : (
        <Flexbox gap={8}>
          {filteredData.map((doc) => (
            <DocumentItem agentId={agentId} document={doc} key={doc.id} mutate={mutate} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentDocumentsGroup.displayName = 'AgentDocumentsGroup';

export default AgentDocumentsGroup;
