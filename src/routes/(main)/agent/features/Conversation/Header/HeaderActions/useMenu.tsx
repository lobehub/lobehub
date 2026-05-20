'use client';

import { type DropdownItem, Icon } from '@lobehub/ui';
import { confirmModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import {
  Clock3Icon,
  Copy,
  ExternalLink,
  Hash,
  Maximize2,
  PencilLine,
  Star,
  Trash,
  Wand2,
} from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';

import { openRenameModal } from '@/components/RenameModal';
import { DOCUMENT_HISTORY_QUERY_LIST_LIMIT } from '@/const/documentHistory';
import { isDesktop } from '@/const/version';
import { openDocumentCompareModal } from '@/features/PageEditor/History/CompareModal';
import { formatHistoryAbsoluteTime } from '@/features/PageEditor/History/formatHistoryDate';
import type {
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
} from '@/server/routers/lambda/_schema/documentHistory';
import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDocumentStore } from '@/store/document';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation(['chat', 'topic', 'common', 'file']);
  const { modal, message } = App.useApp();
  const { pathname } = useLocation();

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);
  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeTopic = useChatStore(topicSelectors.currentActiveTopic);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const [autoRenameTopicTitle, favoriteTopic, removeTopic, updateTopicTitle] = useChatStore((s) => [
    s.autoRenameTopicTitle,
    s.favoriteTopic,
    s.removeTopic,
    s.updateTopicTitle,
  ]);

  const { docId } = useParams<{ docId?: string }>();
  const compareInstanceRef = useRef<ModalInstance | null>(null);

  const saveSourceLabels = useMemo<Record<DocumentHistorySaveSource, string>>(
    () => ({
      autosave: t('pageEditor.history.saveSource.autosave', { ns: 'file' }),
      llm_call: t('pageEditor.history.saveSource.llm_call', { ns: 'file' }),
      manual: t('pageEditor.history.saveSource.manual', { ns: 'file' }),
      restore: t('pageEditor.history.saveSource.restore', { ns: 'file' }),
      system: t('pageEditor.history.saveSource.system', { ns: 'file' }),
    }),
    [t],
  );

  const handleRestoreHistory = useCallback(
    async (item: DocumentHistoryListItem, onSuccess?: () => void): Promise<void> => {
      if (!docId || item.isCurrent) return;

      const { editor, markDirty, performSave } = useDocumentStore.getState();
      if (!editor) {
        message.error(t('pageEditor.history.restoreError', { ns: 'file' }));
        return;
      }

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('pageEditor.history.restoreConfirm.content', {
          ns: 'file',
          savedAt: formatHistoryAbsoluteTime(item.savedAt),
        }),
        okText: t('pageEditor.history.restore', { ns: 'file' }),
        onOk: async () => {
          try {
            const result = await documentService.getDocumentHistoryItem(
              { documentId: docId, historyId: item.id },
              `header-actions-history-${docId}`,
            );

            editor.setDocument('json', JSON.stringify(result.editorData));
            markDirty(docId);
            await performSave(docId, undefined, {
              restoreFromHistoryId: item.id,
              saveSource: 'restore',
            });
            onSuccess?.();
          } catch (error) {
            console.error('[HeaderActions] Failed to restore history item:', error);
            message.error(t('pageEditor.history.restoreError', { ns: 'file' }));
            throw error;
          }
        },
        title: t('pageEditor.history.restoreConfirm.title', { ns: 'file' }),
      });
    },
    [docId, message, t],
  );

  const openCompareModal = useCallback(async (): Promise<void> => {
    if (!docId) return;

    try {
      const result = await documentService.listDocumentHistory({
        documentId: docId,
        includeCurrent: true,
        limit: DOCUMENT_HISTORY_QUERY_LIST_LIMIT,
      });
      const items = result.items ?? [];

      if (items.length === 0) {
        message.info(t('pageEditor.history.empty', { ns: 'file' }));
        return;
      }

      const initialHistoryId = items.find((item) => !item.isCurrent)?.id ?? items[0].id;

      compareInstanceRef.current?.destroy();
      const instance = openDocumentCompareModal({
        documentId: docId,
        initialHistoryId,
        items,
        onRestore: (item) => {
          void handleRestoreHistory(item, () => instance.close());
        },
        saveSourceLabels,
      });
      compareInstanceRef.current = instance;
    } catch (error) {
      console.error('[HeaderActions] Failed to open document compare modal:', error);
      message.error(t('pageEditor.history.compareError', { ns: 'file' }));
    }
  }, [docId, handleRestoreHistory, message, saveSourceLabels, t]);

  const topicId = activeTopic?.id;
  const topicTitle = activeTopic?.title ?? '';
  const isFavorite = !!activeTopic?.favorite;

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    if (topicId) {
      items.push(
        {
          icon: <Icon icon={Star} />,
          key: 'favorite',
          label: t(isFavorite ? 'actions.unfavorite' : 'actions.favorite', { ns: 'topic' }),
          onClick: () => {
            favoriteTopic(topicId, !isFavorite);
          },
        },
        { type: 'divider' as const },
        {
          icon: <Icon icon={Wand2} />,
          key: 'autoRename',
          label: t('actions.autoRename', { ns: 'topic' }),
          onClick: () => {
            autoRenameTopicTitle(topicId);
          },
        },
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: () => {
            openRenameModal({
              defaultValue: topicTitle,
              description: t('renameModal.description', { ns: 'topic' }),
              onSave: async (newTitle) => {
                await updateTopicTitle(topicId, newTitle);
              },
              title: t('renameModal.title', { ns: 'topic' }),
            });
          },
        },
        { type: 'divider' as const },
      );

      if (isDesktop && workingDirectory) {
        items.push({
          icon: <Icon icon={Copy} />,
          key: 'copyWorkingDirectory',
          label: t('actions.copyWorkingDirectory', { ns: 'topic' }),
          onClick: () => {
            void navigator.clipboard.writeText(workingDirectory);
            message.success(t('actions.copyWorkingDirectorySuccess', { ns: 'topic' }));
          },
        });
      }

      if (isDesktop && activeAgentId && !pathname.startsWith('/popup')) {
        items.push({
          icon: <Icon icon={ExternalLink} />,
          key: 'openInPopupWindow',
          label: t('inPopup.title', { ns: 'topic' }),
          onClick: () => {
            openTopicInNewWindow(activeAgentId, topicId);
          },
        });
      }

      items.push(
        {
          icon: <Icon icon={Hash} />,
          key: 'copySessionId',
          label: t('actions.copySessionId', { ns: 'topic' }),
          onClick: () => {
            void navigator.clipboard.writeText(topicId);
            message.success(t('actions.copySessionIdSuccess', { ns: 'topic' }));
          },
        },
        { type: 'divider' as const },
      );
    }

    if (docId) {
      items.push(
        {
          icon: <Icon icon={Clock3Icon} />,
          key: 'open-document-compare',
          label: t('pageEditor.history.compareTitle', { ns: 'file' }),
          onClick: () => {
            void openCompareModal();
          },
        },
        { type: 'divider' as const },
      );
    }

    items.push({
      checked: wideScreen,
      icon: <Icon icon={Maximize2} />,
      key: 'full-width',
      label: t('viewMode.fullWidth'),
      onCheckedChange: toggleWideScreen,
      type: 'switch',
    });

    if (topicId) {
      items.push(
        { type: 'divider' as const },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: () => {
            modal.confirm({
              centered: true,
              okButtonProps: { danger: true },
              onOk: async () => {
                await removeTopic(topicId);
              },
              title: t('actions.confirmRemoveTopic', { ns: 'topic' }),
            });
          },
        },
      );
    }

    return items;
  }, [
    topicId,
    topicTitle,
    isFavorite,
    activeAgentId,
    pathname,
    workingDirectory,
    wideScreen,
    docId,
    autoRenameTopicTitle,
    favoriteTopic,
    openTopicInNewWindow,
    removeTopic,
    updateTopicTitle,
    toggleWideScreen,
    openCompareModal,
    t,
    modal,
    message,
  ]);

  return { menuItems };
};
