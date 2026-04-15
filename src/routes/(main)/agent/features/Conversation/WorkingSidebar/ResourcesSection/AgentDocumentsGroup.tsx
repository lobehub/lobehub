import type { SkillResourceTreeNode } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { App } from 'antd';
import { Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileTree, { FileTreeSkeleton } from '@/features/FileTree';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';

interface AgentDocumentsGroupProps {
  onSelectDocument: (id: string | null) => void;
  selectedDocumentId: string | null;
}

type AgentDocumentListItem = Awaited<ReturnType<typeof agentDocumentService.getDocuments>>[number];

const AgentDocumentsGroup = memo<AgentDocumentsGroupProps>(
  ({ onSelectDocument, selectedDocumentId }) => {
    const { t } = useTranslation(['chat', 'common']);
    const { message, modal } = App.useApp();
    const agentId = useAgentStore((s) => s.activeAgentId);
    const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);

    const {
      data = [],
      error,
      isLoading,
      mutate,
    } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documents(agentId) : null, () =>
      agentDocumentService.getDocuments({ agentId: agentId! }),
    );

    const resourceTree = useMemo<SkillResourceTreeNode[]>(
      () => [
        {
          children: data.map((item) => ({
            name: item.filename || item.title,
            path: item.id,
            type: 'file' as const,
          })),
          name: t('workingPanel.agentDocuments'),
          path: 'agent-documents',
          type: 'directory' as const,
        },
      ],
      [data, t],
    );

    const handleCommitRenameDocument = useCallback(
      async (file: { name: string; path: string }, nextName: string) => {
        if (!agentId) return;

        const normalizedTitle = nextName.trim();
        setEditingDocumentId(null);

        if (!normalizedTitle) {
          message.error(t('workingPanel.resources.renameEmpty', { ns: 'chat' }));
          return;
        }

        if (normalizedTitle === file.name) {
          return;
        }

        try {
          await mutate(
            async (current: AgentDocumentListItem[] = []) => {
              const renamed = await agentDocumentService.renameDocument({
                agentId,
                id: file.path,
                newTitle: normalizedTitle,
              });

              return current.map((item) =>
                item.id === file.path
                  ? {
                      ...item,
                      filename: renamed?.filename ?? item.filename,
                      title: renamed?.title ?? normalizedTitle,
                    }
                  : item,
              );
            },
            {
              optimisticData: (current: AgentDocumentListItem[] = []) =>
                current.map((item) =>
                  item.id === file.path
                    ? {
                        ...item,
                        filename: normalizedTitle,
                        title: normalizedTitle,
                      }
                    : item,
                ),
              revalidate: false,
              rollbackOnError: true,
            },
          );

          message.success(t('workingPanel.resources.renameSuccess', { ns: 'chat' }));
        } catch (error) {
          message.error(
            error instanceof Error
              ? error.message
              : t('workingPanel.resources.renameError', { ns: 'chat' }),
          );
        }
      },
      [agentId, message, mutate, t],
    );

    const handleDeleteDocument = useCallback(
      (id: string) => {
        if (!agentId) return;

        modal.confirm({
          content: t('workingPanel.resources.deleteConfirm', { ns: 'chat' }),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: async () => {
            const wasSelected = selectedDocumentId === id;
            if (wasSelected) onSelectDocument(null);

            try {
              await mutate(
                async (current = []) => {
                  await agentDocumentService.removeDocument({ agentId, id });
                  return current.filter((item) => item.id !== id);
                },
                {
                  optimisticData: (current = []) => current.filter((item) => item.id !== id),
                  revalidate: false,
                  rollbackOnError: true,
                },
              );

              message.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
            } catch (error) {
              if (wasSelected) onSelectDocument(id);
              message.error(
                error instanceof Error
                  ? error.message
                  : t('workingPanel.resources.deleteError', { ns: 'chat' }),
              );
              throw error;
            }
          },
          title: t('workingPanel.resources.deleteTitle', { ns: 'chat' }),
        });
      },
      [agentId, message, modal, mutate, onSelectDocument, selectedDocumentId, t],
    );

    const getFileContextMenuItems = useCallback(
      (file: { path: string }) => [
        {
          icon: <Icon icon={Pencil} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: () => setEditingDocumentId(file.path),
        },
        { type: 'divider' as const },
        {
          danger: true,
          icon: <Icon icon={Trash2} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: () => handleDeleteDocument(file.path),
        },
      ],
      [handleDeleteDocument, t],
    );

    if (!agentId) return null;

    return (
      <Flexbox gap={8}>
        {isLoading && <FileTreeSkeleton rows={6} showRootFile={false} />}
        {error && <Text type={'danger'}>{t('workingPanel.resources.error')}</Text>}
        {!isLoading && !error && data.length === 0 && (
          <Text type={'secondary'}>{t('workingPanel.resources.empty')}</Text>
        )}
        {!isLoading && !error && data.length > 0 && (
          <FileTree
            editableFilePath={editingDocumentId}
            getFileContextMenuItems={getFileContextMenuItems}
            resourceTree={resourceTree}
            rootFile={null}
            selectedFile={selectedDocumentId || ''}
            onCancelRenameFile={() => setEditingDocumentId(null)}
            onCommitRenameFile={handleCommitRenameDocument}
            onSelectFile={onSelectDocument}
          />
        )}
      </Flexbox>
    );
  },
);

AgentDocumentsGroup.displayName = 'AgentDocumentsGroup';

export default AgentDocumentsGroup;
