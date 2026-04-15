'use client';

import { ActionIcon, Button, Empty, Flexbox, Tag, Text } from '@lobehub/ui';
import type { ModalInstance } from '@lobehub/ui/base-ui';
import { App, Tooltip } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ArrowLeftIcon, Clock3Icon, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { DOCUMENT_HISTORY_LIST_LIMIT } from '@/const/documentHistory';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
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

interface HistoryDayGroup {
  items: DocumentHistoryListItem[];
  key: string;
  label: string;
}

const TIMELINE_DOT_SIZE = 6;
const TIMELINE_LINE_INSET = 14;
const TIMELINE_ROW_PADDING_TOP = 6;
const TIMELINE_ROW_PADDING_INLINE = 8;
const TIMELINE_ROW_PADDING_BOTTOM = 6;
const TIMELINE_DOT_TOP = 12;
const TIMELINE_CONTENT_OFFSET = TIMELINE_LINE_INSET + TIMELINE_DOT_SIZE / 2 + 10;

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    height: 100%;
    padding: 24px;
  `,
  groupHeader: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 14px 2px;
    padding-inline-start: ${TIMELINE_CONTENT_OFFSET}px;

    background: ${cssVar.colorBgContainer};
  `,
  groupLabel: css`
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};
  `,
  headerButton: css`
    padding-inline: 8px;
  `,
  list: css`
    position: relative;

    overflow-y: auto;
    flex: 1;

    min-height: 0;
    padding-block: 0 20px;
    padding-inline: 8px 12px;
  `,
  rail: css`
    position: absolute;
    inset-block: 0;
    inset-inline-start: ${TIMELINE_LINE_INSET}px;

    width: 1px;

    background: ${cssVar.colorFillSecondary};
  `,
  row: css`
    position: relative;
    padding-block: 1px;
    padding-inline-start: ${TIMELINE_CONTENT_OFFSET}px;

    &:hover,
    &:focus-within {
      .history-actions {
        pointer-events: auto;
        opacity: 1;
      }
    }
  `,
  rowBody: css`
    padding-block: ${TIMELINE_ROW_PADDING_TOP}px ${TIMELINE_ROW_PADDING_BOTTOM}px;
    padding-inline: ${TIMELINE_ROW_PADDING_INLINE}px;
    border-radius: 6px;
    transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rowBodyClickable: css`
    cursor: pointer;
  `,
  rowCurrent: css`
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rowDot: css`
    position: absolute;
    inset-block-start: ${TIMELINE_DOT_TOP}px;
    inset-inline-start: ${TIMELINE_LINE_INSET - TIMELINE_DOT_SIZE / 2}px;

    width: ${TIMELINE_DOT_SIZE}px;
    height: ${TIMELINE_DOT_SIZE}px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 999px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 3px ${cssVar.colorBgContainer};
  `,
  rowDotCurrent: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimary};
  `,
  rowDotRestore: css`
    box-shadow:
      0 0 0 2px ${cssVar.colorPrimaryBorder},
      0 0 0 4px ${cssVar.colorBgContainer};
  `,
  rowTime: css`
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  rowMeta: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,

  versionActions: css`
    pointer-events: none;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
  `,
}));

const formatAbsoluteTime = (savedAt: string) => dayjs(savedAt).format('MMMM D, YYYY h:mm A');
const formatDayGroupLabel = (savedAt: string) => {
  const d = dayjs(savedAt);
  const now = dayjs();
  if (d.isSame(now, 'day')) return 'Today';
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format('MMMM D, YYYY');
};

const createHistoryDayGroups = (items: DocumentHistoryListItem[]): HistoryDayGroup[] => {
  const groups = new Map<string, HistoryDayGroup>();

  for (const item of items) {
    const key = dayjs(item.savedAt).format('YYYY-MM-DD');
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      items: [item],
      key,
      label: formatDayGroupLabel(item.savedAt),
    });
  }

  return [...groups.values()];
};

const HistoryPanel = memo(() => {
  const { t } = useTranslation(['common', 'file']);
  const { message, modal } = App.useApp();

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
        limit: DOCUMENT_HISTORY_LIST_LIMIT,
      }),
    { keepPreviousData: true },
  );

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const groups = useMemo(() => createHistoryDayGroups(items), [items]);
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

  const handleRestore = useCallback(
    (item: DocumentHistoryListItem, onSuccess?: () => void) => {
      if (!documentId || !editor || item.isCurrent) return;

      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('pageEditor.history.restoreConfirm.content', {
          ns: 'file',
          savedAt: formatAbsoluteTime(item.savedAt),
        }),
        okText: t('pageEditor.history.restore', { ns: 'file' }),
        onOk: async () => {
          setRestoringHistoryId(item.id);

          try {
            const result = await documentService.getDocumentHistoryItem(
              { documentId, historyId: item.id },
              `page-editor-history-${documentId}`,
            );

            editor.setDocument('json', JSON.stringify(result.editorData));
            markDirty(documentId);
            await performSave(documentId, undefined, {
              restoreFromHistoryId: item.id,
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
        title: t('pageEditor.history.restoreConfirm.title', {
          ns: 'file',
          savedAt: formatAbsoluteTime(item.savedAt),
        }),
      });
    },
    [documentId, editor, markDirty, message, modal, performSave, t],
  );

  const openCompareModal = useCallback(
    (initialHistoryId: string) => {
      compareInstanceRef.current?.destroy();
      const instance = openDocumentCompareModal({
        documentId: documentId!,
        initialHistoryId,
        items,
        onRestore: (item) => handleRestore(item, () => instance.close()),
        saveSourceLabels,
      });
      compareInstanceRef.current = instance;
    },
    [documentId, handleRestore, items, saveSourceLabels],
  );

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
        <Flexbox className={styles.list} gap={0}>
          <div className={styles.rail} />
          {groups.map((group) => (
            <Flexbox gap={0} key={group.key}>
              <Flexbox horizontal align={'center'} className={styles.groupHeader}>
                <Text className={styles.groupLabel}>{group.label}</Text>
              </Flexbox>

              {group.items.map((item) => {
                const isRestoring = restoringHistoryId === item.id;
                const timeLabel = dayjs(item.savedAt).format('h:mm A');

                return (
                  <Flexbox className={styles.row} gap={0} key={item.id}>
                    <div
                      className={cx(
                        styles.rowDot,
                        item.isCurrent && styles.rowDotCurrent,
                        item.saveSource === 'restore' && styles.rowDotRestore,
                      )}
                    />
                    <Flexbox
                      horizontal
                      align={'center'}
                      distribution={'space-between'}
                      gap={8}
                      className={cx(
                        styles.rowBody,
                        item.isCurrent && styles.rowCurrent,
                        !item.isCurrent && styles.rowBodyClickable,
                      )}
                      onClick={item.isCurrent ? undefined : () => openCompareModal(item.id)}
                    >
                      <Tooltip title={formatAbsoluteTime(item.savedAt)}>
                        <Flexbox
                          horizontal
                          align={'center'}
                          gap={8}
                          style={{ minWidth: 0, overflow: 'hidden' }}
                        >
                          <span className={styles.rowTime}>{timeLabel}</span>
                          {item.isCurrent && (
                            <Tag size={'small'} variant={'borderless'}>
                              {t('pageEditor.history.current', { ns: 'file' })}
                            </Tag>
                          )}
                          <span className={styles.rowMeta}>
                            {saveSourceLabels[item.saveSource]}
                          </span>
                        </Flexbox>
                      </Tooltip>
                      {!item.isCurrent && (
                        <Flexbox
                          horizontal
                          align={'center'}
                          className={`history-actions ${styles.versionActions}`}
                          gap={6}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ActionIcon
                            icon={RotateCcwIcon}
                            loading={isRestoring}
                            size={{ blockSize: 26, borderRadius: '50%', size: 14 }}
                            title={t('pageEditor.history.restore', { ns: 'file' })}
                            onClick={() => handleRestore(item)}
                          />
                        </Flexbox>
                      )}
                    </Flexbox>
                  </Flexbox>
                );
              })}
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

HistoryPanel.displayName = 'HistoryPanel';

export default HistoryPanel;
