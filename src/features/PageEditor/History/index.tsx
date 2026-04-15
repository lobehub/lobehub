'use client';

import { ActionIcon, Button, Empty, Flexbox, Tag, Text } from '@lobehub/ui';
import { confirmModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { App, Tooltip } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ArrowLeftIcon, ArrowLeftRightIcon, Clock3Icon, RotateCcwIcon } from 'lucide-react';
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
import { formatHistoryAbsoluteTime, formatHistoryRowTime } from './formatHistoryDate';

interface HistoryDayGroup {
  items: DocumentHistoryListItem[];
  key: string;
  label: string;
}

type TagColor = 'default' | 'success' | 'purple' | 'geekblue' | 'gold' | 'processing';

const SOURCE_TAG_COLOR: Record<DocumentHistorySaveSource, TagColor> = {
  autosave: 'default',
  llm_call: 'purple',
  manual: 'success',
  restore: 'geekblue',
  system: 'gold',
};

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
  row: css`
    cursor: pointer;

    position: relative;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 16px;

    transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover,
    &:focus-within {
      background: ${cssVar.colorFillQuaternary};

      .history-source-tag {
        opacity: 0;
      }

      .history-actions {
        pointer-events: auto;
        opacity: 1;
      }
    }
  `,
  rowCurrent: css`
    cursor: default;

    &:hover,
    &:focus-within {
      background: transparent;

      .history-source-tag {
        opacity: 1;
      }
    }
  `,
  rowTime: css`
    flex-shrink: 0;

    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  rowTimeCurrent: css`
    font-size: 14px;
    color: ${cssVar.colorPrimary};
  `,
  currentBadge: css`
    flex-shrink: 0;
    margin: 0;
  `,
  rowSpacer: css`
    flex: 1;
  `,
  sourceTag: css`
    flex-shrink: 0;
    margin: 0;
    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
  `,
  actions: css`
    pointer-events: none;

    position: absolute;
    inset-block: 50%;
    inset-inline-end: 10px;
    transform: translateY(-50%);

    display: flex;
    gap: 2px;
    align-items: center;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
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
        limit: DOCUMENT_HISTORY_LIST_LIMIT,
      }),
    { keepPreviousData: true },
  );

  const items = useMemo(() => data?.items ?? [], [data?.items]);
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
        group.items.push(item);
        continue;
      }

      let label: string;
      if (d.isSame(now, 'day')) label = todayLabel;
      else if (d.isSame(now.subtract(1, 'day'), 'day')) label = yesterdayLabel;
      else label = d.format('MMMM D, YYYY');

      map.set(key, { items: [item], key, label });
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

  const handleRestore = useCallback(
    (item: DocumentHistoryListItem, onSuccess?: () => void) => {
      if (!documentId || !editor || item.isCurrent) return;

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('pageEditor.history.restoreConfirm.content', {
          ns: 'file',
          savedAt: formatHistoryAbsoluteTime(item.savedAt),
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
        title: t('pageEditor.history.restoreConfirm.title', { ns: 'file' }),
      });
    },
    [documentId, editor, markDirty, message, performSave, t],
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
          {groups.map((group) => (
            <Flexbox gap={0} key={group.key}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{group.label}</span>
                <span className={styles.groupCount}>
                  {t('pageEditor.history.versionCount', {
                    count: group.items.length,
                    ns: 'file',
                  })}
                </span>
              </div>

              {group.items.map((item) => {
                const isRestoring = restoringHistoryId === item.id;
                const timeLabel = formatHistoryRowTime(item.savedAt);

                return (
                  <div
                    className={cx(styles.row, item.isCurrent && styles.rowCurrent)}
                    key={item.id}
                    onClick={item.isCurrent ? undefined : () => openCompareModal(item.id)}
                  >
                    <Tooltip title={formatHistoryAbsoluteTime(item.savedAt)}>
                      <span className={cx(styles.rowTime, item.isCurrent && styles.rowTimeCurrent)}>
                        {timeLabel}
                      </span>
                    </Tooltip>

                    {item.isCurrent && (
                      <Tag
                        className={styles.currentBadge}
                        color={'processing'}
                        size={'small'}
                        variant={'borderless'}
                      >
                        {t('pageEditor.history.current', { ns: 'file' })}
                      </Tag>
                    )}

                    <span className={styles.rowSpacer} />

                    <Tag
                      className={cx(styles.sourceTag, 'history-source-tag')}
                      color={SOURCE_TAG_COLOR[item.saveSource]}
                      size={'small'}
                      variant={'borderless'}
                    >
                      {saveSourceLabels[item.saveSource]}
                    </Tag>

                    {!item.isCurrent && (
                      <Flexbox
                        horizontal
                        align={'center'}
                        className={cx(styles.actions, 'history-actions')}
                        gap={2}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ActionIcon
                          icon={ArrowLeftRightIcon}
                          size={{ blockSize: 26, borderRadius: '50%', size: 14 }}
                          title={t('pageEditor.history.compare', { ns: 'file' })}
                          onClick={() => openCompareModal(item.id)}
                        />
                        <ActionIcon
                          icon={RotateCcwIcon}
                          loading={isRestoring}
                          size={{ blockSize: 26, borderRadius: '50%', size: 14 }}
                          title={t('pageEditor.history.restore', { ns: 'file' })}
                          onClick={() => handleRestore(item)}
                        />
                      </Flexbox>
                    )}
                  </div>
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
