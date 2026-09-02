'use client';

import { type AnnotationRecord, type AnnotationService, IAnnotationService } from '@lobehub/editor';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Empty, Typography } from 'antd';
import { MessageSquareTextIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageEditorStore } from '../store';
import { focusAnnotation } from './focusAnnotation';

const getCommentText = (record: AnnotationRecord, fallback: string) => {
  const payload = record.payload as { text?: string } | string | null;
  if (typeof payload === 'string') return payload;
  return typeof payload?.text === 'string' ? payload.text : fallback;
};

const AnnotationPanel = memo(() => {
  const { t } = useTranslation('editor');
  const editor = usePageEditorStore((s) => s.editor);
  const [records, setRecords] = useState<AnnotationRecord[]>([]);

  useEffect(() => {
    if (!editor) return;

    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const subscribe = () => {
      if (disposed) return;
      const service = editor.requireService(IAnnotationService) as AnnotationService | null;
      if (!service) {
        retryTimer = setTimeout(subscribe, 100);
        return;
      }
      unsubscribe = service.subscribe((nextRecords) => {
        setRecords(nextRecords.filter((record) => record.kind === 'comment'));
      });
    };

    subscribe();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [editor]);

  if (records.length === 0) {
    return (
      <Flexbox align="center" flex={1} justify="center" padding={24}>
        <Empty description={t('annotation.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Flexbox>
    );
  }

  return (
    <Flexbox flex={1} gap={8} padding={12} style={{ overflowY: 'auto' }}>
      {records.map((record) => (
        <Button
          key={record.id}
          style={{ height: 'auto', justifyContent: 'flex-start', padding: 12, textAlign: 'left' }}
          type="default"
          onClick={() => editor && focusAnnotation(editor, record.id)}
        >
          <Flexbox gap={6} style={{ minWidth: 0, width: '100%' }}>
            <Flexbox horizontal align="center" gap={6}>
              <MessageSquareTextIcon size={14} />
              <Typography.Text strong>
                {getCommentText(record, t('annotation.invalidPayload')) || t('annotation.title')}
              </Typography.Text>
            </Flexbox>
            <Typography.Text ellipsis={{ tooltip: record.quotedText }} type="secondary">
              {record.quotedText || t('annotation.noQuote')}
            </Typography.Text>
          </Flexbox>
        </Button>
      ))}
    </Flexbox>
  );
});

AnnotationPanel.displayName = 'AnnotationPanel';

export default AnnotationPanel;
