'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { RotateCcwIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import type {
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
} from '@/server/routers/lambda/_schema/documentHistory';

import DocumentHistoryDiff from '../DocumentHistoryDiff';
import { formatHistoryAbsoluteTime } from '../formatHistoryDate';
import HistorySidebar from './HistorySidebar';

const styles = createStaticStyles(({ css }) => ({
  arrow: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  badgeNew: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 4px;

    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
  badgeOld: css`
    display: inline-flex;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 4px;

    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  cmpbar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgLayout};
  `,
  diffArea: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  diffBody: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  meta: css`
    margin-inline-start: 8px;
    font-size: 11px;
    line-height: 1.2;
  `,
  root: css`
    overflow: hidden;
    display: flex;

    width: 100%;
    height: 100%;

    background: ${cssVar.colorBgContainer};
  `,
}));

export interface CompareContentProps {
  documentId: string;
  initialHistoryId: string;
  items: DocumentHistoryListItem[];
  onRestore: (item: DocumentHistoryListItem) => void;
  saveSourceLabels: Record<DocumentHistorySaveSource, string>;
}

const CompareContent = memo<CompareContentProps>(
  ({ documentId, initialHistoryId, items, onRestore, saveSourceLabels }) => {
    const { t } = useTranslation('file');

    const [selectedHistoryId, setSelectedHistoryId] = useState<string>(initialHistoryId);

    const selectedItem = useMemo(
      () => items.find((item) => item.id === selectedHistoryId) ?? null,
      [items, selectedHistoryId],
    );

    const authorInfo = useAuthorInfo(selectedItem?.userId);

    if (!selectedItem) return null;

    const canRestore = !selectedItem.isCurrent;

    return (
      <div className={styles.root}>
        <div className={styles.diffArea}>
          <div className={styles.cmpbar}>
            <Flexbox horizontal align={'center'} gap={4}>
              <span className={styles.badgeNew}>{t('pageEditor.history.compareCurrentLabel')}</span>
              <Text className={styles.arrow}>→</Text>
              <span className={styles.badgeOld}>
                {formatHistoryAbsoluteTime(selectedItem.savedAt)}
              </span>
              <Text className={styles.meta} type={'secondary'}>
                {dayjs(selectedItem.savedAt).fromNow()} ·{' '}
                {saveSourceLabels[selectedItem.saveSource]}
              </Text>
              {authorInfo?.fullName && (
                <Text className={styles.meta} title={authorInfo.fullName} type={'secondary'}>
                  · {authorInfo.fullName}
                </Text>
              )}
            </Flexbox>
            {canRestore && (
              <Button icon={RotateCcwIcon} size={'small'} onClick={() => onRestore(selectedItem)}>
                {t('pageEditor.history.restore')} {formatHistoryAbsoluteTime(selectedItem.savedAt)}
              </Button>
            )}
          </div>
          <div className={styles.diffBody}>
            <DocumentHistoryDiff documentId={documentId} historyId={selectedItem.id} />
          </div>
        </div>
        <HistorySidebar
          items={items}
          saveSourceLabels={saveSourceLabels}
          selectedHistoryId={selectedHistoryId}
          onSelect={setSelectedHistoryId}
        />
      </div>
    );
  },
);

CompareContent.displayName = 'CompareContent';

export default CompareContent;
