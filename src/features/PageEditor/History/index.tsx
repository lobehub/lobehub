'use client';

import { Button, Empty, Flexbox, Text } from '@lobehub/ui';
import { confirmModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ArrowLeftIcon, Clock3Icon } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { DOCUMENT_HISTORY_QUERY_LIST_LIMIT } from '@/const/documentHistory';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useClientDataSWR } from '@/libs/swr';
import type {
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
  ListHistoryOutput,
} from '@/server/routers/lambda/_schema/documentHistory';
import { documentService } from '@/services/document';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { selectors, usePageEditorStore } from '../store';
import { openDocumentCompareModal } from './CompareModal';
import { formatHistoryAbsoluteTime } from './formatHistoryDate';
import { HistoryItemsProvider } from './HistoryItemsProvider';
import { HistoryListItem } from './HistoryListItem';

interface HistoryDayGroup {
  historyIds: string[];
  key: string;
  label: string;
}

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    height: 100%;
    padding: 24px;
  `,
  groupHeader: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    display: flex;
    gap: 8px;
    align-items: baseline;

    padding-block: 14px 6px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    background: ${cssVar.colorBgContainer};
  `,
  groupTitle: css`
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  groupCount: css`
    font-size: 11px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  headerButton: css`
    padding-inline: 8px;
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-block: 0 20px;
  `,
}));

const HistoryPanel = memo(() => {
  const { t } = useTranslation(['common', 'file']);
  const { message } = App.useApp();

  const documentId = usePageEditorStore(selectors.documentId);
  const editor = usePageEditorStore(selectors.editor);
  const setRightPanelMode = usePageEditorStore((s) => s.setRightPanelMode);

  const markDirty = useDocumentStore((s) => s.markDirty);
  const performSave = useDocumentStore((s) => s.performSave);
  const lastUpdatedTime = useDocumentStore(
    (s) => editorSelectors.lastUpdatedTime(documentId!)(s) ?? null,
  );

  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);
  const compareInstanceRef = useRef<ModalInstance | null>(null);

  const { data, isLoading } = useClientDataSWR<ListHistoryOutput>(
    documentId ? ['page-editor-document-history', documentId, lastUpdatedTime] : null,
    async () =>
      documentService.listDocumentHistory({
        documentId: documentId!,
        includeCurrent: true,
        limit: DOCUMENT_HISTORY_QUERY_LIST_LIMIT,
      }),
    { keepPreviousData: true },
  );

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const historyItemsById = useMemo<Record<string, DocumentHistoryListItem>>(() => {
    const nextItemsById: Record<string, DocumentHistoryListItem> = {};

    for (const item of items) {
      nextItemsById[item.id] = item;
    }

    return nextItemsById;
  }, [items]);

  const groups = useMemo<HistoryDayGroup[]>(() => {
    const now = dayjs();
    const todayLabel = t('pageEditor.history.dayLabel.today', { ns: 'file' });
    const yesterdayLabel = t('pageEditor.history.dayLabel.yesterday', { ns: 'file' });

    const map = new Map<string, HistoryDayGroup>();

    for (const item of items) {
      const d = dayjs(item.savedAt);
      const key = d.format('YYYY-MM-DD');
      const group = map.get(key);

      if (group) {
        group.historyIds.push(item.id);
        continue;
      }

      let label: string;
      if (d.isSame(now, 'day')) label = todayLabel;
      else if (d.isSame(now.subtract(1, 'day'), 'day')) label = yesterdayLabel;
      else label = d.format('MMMM D, YYYY');

      map.set(key, { historyIds: [item.id], key, label });
    }

    return [...map.values()];
  }, [items, t]);

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

  const handleRestore = useEventCallback((historyId: string, onSuccess?: () => void) => {
    const item = historyItemsById[historyId];

    if (!documentId || !editor || !item || item.isCurrent) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('pageEditor.history.restoreConfirm.content', {
        ns: 'file',
        savedAt: formatHistoryAbsoluteTime(item.savedAt),
      }),
      okText: t('pageEditor.history.restore', { ns: 'file' }),
      onOk: async () => {
        setRestoringHistoryId(historyId);

        try {
          const result = await documentService.getDocumentHistoryItem(
            { documentId, historyId },
            `page-editor-history-${documentId}`,
          );

          editor.setDocument('json', JSON.stringify(result.editorData));
          markDirty(documentId);
          await performSave(documentId, undefined, {
            restoreFromHistoryId: historyId,
            saveSource: 'restore',
          });
          onSuccess?.();
        } catch (error) {
          console.error('[PageEditor] Failed to restore history item:', error);
          message.error(t('pageEditor.history.restoreError', { ns: 'file' }));
          throw error;
        } finally {
          setRestoringHistoryId(null);
        }
      },
      title: t('pageEditor.history.restoreConfirm.title', { ns: 'file' }),
    });
  });

  const openCompareModal = useEventCallback((initialHistoryId: string) => {
    if (!documentId) return;

    compareInstanceRef.current?.destroy();

    const instance = openDocumentCompareModal({
      documentId,
      initialHistoryId,
      items,
      onRestore: (item) => handleRestore(item.id, () => instance.close()),
      saveSourceLabels,
    });
    compareInstanceRef.current = instance;
  });

  if (!documentId) return null;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        showTogglePanelButton={false}
        left={
          <Text
            ellipsis={{ tooltipWhenOverflow: true }}
            style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}
            type={'secondary'}
          >
            {t('pageEditor.history.title', { ns: 'file' })}
          </Text>
        }
        right={
          <>
            <Button
              className={styles.headerButton}
              icon={ArrowLeftIcon}
              size={'small'}
              type={'text'}
              onClick={() => setRightPanelMode('copilot')}
            >
              {t('pageEditor.history.backToCopilot', { ns: 'file' })}
            </Button>
            <ToggleRightPanelButton showActive={false} />
          </>
        }
      />

      {isLoading && !data ? (
        <Flexbox align={'center'} className={styles.empty} justify={'center'}>
          <Loading debugId={'DocumentHistoryPanel'} />
        </Flexbox>
      ) : items.length === 0 ? (
        <Flexbox align={'center'} className={styles.empty} justify={'center'}>
          <Empty description={t('pageEditor.history.empty', { ns: 'file' })} icon={Clock3Icon} />
        </Flexbox>
      ) : (
        <HistoryItemsProvider items={items} restoringHistoryId={restoringHistoryId}>
          <Flexbox className={styles.list} gap={0}>
            {groups.map((group) => (
              <Flexbox gap={0} key={group.key}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupTitle}>{group.label}</span>
                  <span className={styles.groupCount}>
                    {t('pageEditor.history.versionCount', {
                      count: group.historyIds.length,
                      ns: 'file',
                    })}
                  </span>
                </div>

                {group.historyIds.map((historyId) => (
                  <HistoryListItem
                    historyId={historyId}
                    key={historyId}
                    onCompare={openCompareModal}
                    onRestore={handleRestore}
                  />
                ))}
              </Flexbox>
            ))}
          </Flexbox>
        </HistoryItemsProvider>
      )}
    </Flexbox>
  );
});

HistoryPanel.displayName = 'HistoryPanel';

export default HistoryPanel;
