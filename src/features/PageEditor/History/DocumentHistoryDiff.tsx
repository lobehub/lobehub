'use client';

import type { LexicalDiffProps } from '@lobehub/editor/renderer';
import { LexicalDiff } from '@lobehub/editor/renderer';
import { Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { SerializedEditorState } from 'lexical';
import { GitCompareArrowsIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CircleLoading from '@/components/Loading/CircleLoading';
import { useClientDataSWR } from '@/libs/swr';
import type { CompareHistoryItemsOutput } from '@/server/routers/lambda/_schema/documentHistory';
import { documentService } from '@/services/document';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minHeight: '0',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  content: { overflow: 'auto', flex: '1', minHeight: '0' },
  empty: { padding: '24px' },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSerializedEditorState = (value: unknown): value is SerializedEditorState =>
  isObject(value) && isObject(value.root) && Array.isArray(value.root.children);

const isSerializedRootNode = (value: unknown): value is SerializedEditorState['root'] =>
  isObject(value) && value.type === 'root' && Array.isArray(value.children);

const normalizeEditorState = (value: unknown): SerializedEditorState | null => {
  if (isSerializedEditorState(value)) return value;
  if (isSerializedRootNode(value)) return { root: value };

  return null;
};

interface DocumentHistoryDiffProps {
  documentId: string;
  historyId: string;
}

const DocumentHistoryDiff = memo<DocumentHistoryDiffProps>(({ documentId, historyId }) => {
  const { t } = useTranslation('file');
  const lastUpdatedTime = useDocumentStore(
    (s) => editorSelectors.lastUpdatedTime(documentId)(s) ?? null,
  );

  const { data, error, isLoading } = useClientDataSWR<CompareHistoryItemsOutput>(
    ['page-editor-document-history-compare', documentId, historyId, lastUpdatedTime],
    async () =>
      documentService.compareDocumentHistoryItems({
        documentId,
        fromHistoryId: 'head',
        toHistoryId: historyId,
      }),
  );

  const labels = useMemo<NonNullable<LexicalDiffProps['labels']>>(
    () => ({
      new: t('pageEditor.history.compareOldLabel'),
      old: t('pageEditor.history.compareCurrentLabel'),
    }),
    [t],
  );
  const normalizedValues = useMemo(() => {
    const oldValue = normalizeEditorState(data?.from.editorData);
    const newValue = normalizeEditorState(data?.to.editorData);

    return { newValue, oldValue };
  }, [data?.from.editorData, data?.to.editorData]);

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={0}>
      {isLoading && !data ? (
        <Flexbox
          align={'center'}
          className={stylex.props(styles.empty).className}
          justify={'center'}
        >
          <CircleLoading />
        </Flexbox>
      ) : error || !data || !normalizedValues.oldValue || !normalizedValues.newValue ? (
        <Flexbox
          align={'center'}
          className={stylex.props(styles.empty).className}
          justify={'center'}
        >
          <Empty description={t('pageEditor.history.compareError')} icon={GitCompareArrowsIcon} />
        </Flexbox>
      ) : (
        <div {...stylex.props(styles.content)}>
          <LexicalDiff
            appearance={'borderless'}
            labels={labels}
            newValue={normalizedValues.newValue}
            oldValue={normalizedValues.oldValue}
            variant="chat"
          />
        </div>
      )}
    </Flexbox>
  );
});

DocumentHistoryDiff.displayName = 'DocumentHistoryDiff';

export default DocumentHistoryDiff;
