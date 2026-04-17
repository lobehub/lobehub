import { ActionIcon, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon, Trash2Icon } from 'lucide-react';
import { memo, type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';

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
  title: css`
    font-weight: 500;
  `,
}));

interface AgentDocumentsGroupProps {
  onSelectDocument: (id: string | null) => void;
  selectedDocumentId: string | null;
}

type AgentDocumentListItem = Awaited<ReturnType<typeof agentDocumentService.getDocuments>>[number];

interface DocumentItemProps {
  agentId: string;
  document: AgentDocumentListItem;
  isActive: boolean;
  mutate: () => Promise<unknown>;
  onDeselect: () => void;
  onSelect: (id: string) => void;
}

const DocumentItem = memo<DocumentItemProps>(
  ({ agentId, document, isActive, mutate, onDeselect, onSelect }) => {
    const { t } = useTranslation(['chat', 'common']);
    const { message, modal } = App.useApp();
    const [deleting, setDeleting] = useState(false);

    const title = document.filename || document.title || '';
    const description = document.description ?? undefined;

    const handleDelete = (e: MouseEvent) => {
      e.stopPropagation();
      modal.confirm({
        centered: true,
        content: t('workingPanel.resources.deleteConfirm', { ns: 'chat' }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          setDeleting(true);
          try {
            if (isActive) onDeselect();
            await agentDocumentService.removeDocument({ agentId, id: document.id });
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
        className={`${styles.container} ${isActive ? styles.containerActive : ''}`}
        gap={8}
        onClick={() => onSelect(document.id)}
      >
        <FileTextIcon size={16} />
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
        </Flexbox>
      </Flexbox>
    );
  },
);

DocumentItem.displayName = 'AgentDocumentsGroupItem';

const AgentDocumentsGroup = memo<AgentDocumentsGroupProps>(
  ({ onSelectDocument, selectedDocumentId }) => {
    const { t } = useTranslation('chat');
    const agentId = useAgentStore((s) => s.activeAgentId);

    const {
      data = [],
      error,
      isLoading,
      mutate,
    } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documents(agentId) : null, () =>
      agentDocumentService.getDocuments({ agentId: agentId! }),
    );

    if (!agentId) return null;

    return (
      <Flexbox gap={8}>
        {isLoading && <Skeleton active paragraph={{ rows: 4 }} title={false} />}
        {error && <Text type={'danger'}>{t('workingPanel.resources.error')}</Text>}
        {!isLoading && !error && data.length === 0 && (
          <Text type={'secondary'}>{t('workingPanel.resources.empty')}</Text>
        )}
        {!isLoading &&
          !error &&
          data.length > 0 &&
          data.map((doc) => (
            <DocumentItem
              agentId={agentId}
              document={doc}
              isActive={selectedDocumentId === doc.id}
              key={doc.id}
              mutate={mutate}
              onDeselect={() => onSelectDocument(null)}
              onSelect={onSelectDocument}
            />
          ))}
      </Flexbox>
    );
  },
);

AgentDocumentsGroup.displayName = 'AgentDocumentsGroup';

export default AgentDocumentsGroup;
