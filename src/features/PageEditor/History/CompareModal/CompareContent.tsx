'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  arrow: { fontSize: '12px', color: cssVar.colorTextTertiary },
  badgeNew: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1.2,
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  badgeOld: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1.2,
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  cmpbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  diffArea: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: '0',
    minHeight: '0',
  },
  diffBody: { overflow: 'auto', flex: '1', minHeight: '0' },
  meta: { marginInlineStart: '8px', fontSize: '11px', lineHeight: 1.2 },
  root: {
    overflow: 'hidden',
    display: 'flex',
    width: '100%',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

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
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.diffArea)}>
          <div {...stylex.props(styles.cmpbar)}>
            <Flexbox horizontal align={'center'} gap={4}>
              <span {...stylex.props(styles.badgeNew)}>
                {t('pageEditor.history.compareCurrentLabel')}
              </span>
              <Text className={stylex.props(styles.arrow).className}>→</Text>
              <span {...stylex.props(styles.badgeOld)}>
                {formatHistoryAbsoluteTime(selectedItem.savedAt)}
              </span>
              <Text className={stylex.props(styles.meta).className} type={'secondary'}>
                {dayjs(selectedItem.savedAt).fromNow()} ·{' '}
                {saveSourceLabels[selectedItem.saveSource]}
              </Text>
              {authorInfo?.fullName && (
                <Text
                  className={stylex.props(styles.meta).className}
                  title={authorInfo.fullName}
                  type={'secondary'}
                >
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
          <div {...stylex.props(styles.diffBody)}>
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
