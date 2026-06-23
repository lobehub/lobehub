'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { App, DatePicker } from 'antd';
import { type RangePickerProps } from 'antd/es/date-picker';
import dayjs from 'dayjs';
import { t as i18nT } from 'i18next';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryAnalysisAsyncTask } from '@/routes/(main)/memory/features/MemoryAnalysis/useTask';
import { memoryExtractionService } from '@/services/userMemory/extraction';

const DateRangeContent = memo(() => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const { refresh } = useMemoryAnalysisAsyncTask();
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [submitting, setSubmitting] = useState(false);

  const disabledDate = useCallback<NonNullable<RangePickerProps['disabledDate']>>(
    (current) => current.isAfter(dayjs(), 'day'),
    [],
  );

  const footerNote = useMemo(
    () =>
      range[0] || range[1]
        ? t('analysis.modal.rangeSelected', {
            end:
              range[1]?.toISOString().slice(0, 10)?.replaceAll('-', '/') || t('analysis.range.end'),
            start:
              range[0]?.toISOString().slice(0, 10)?.replaceAll('-', '/') ||
              t('analysis.range.start'),
          })
        : t('analysis.modal.rangePlaceholder'),
    [range, t],
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const [from, to] = range;
      const result = await memoryExtractionService.requestFromChatTopics({
        fromDate: from ?? undefined,
        toDate: to ?? undefined,
      });

      await refresh();
      message.success(result.deduped ? t('analysis.toast.deduped') : t('analysis.toast.started'));
      close();
    } catch (error) {
      console.error(error);
      message.error(t('analysis.toast.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={12}>
        <Text type={'secondary'}>{t('analysis.modal.helper')}</Text>
        <DatePicker.RangePicker
          allowClear
          disabledDate={disabledDate}
          format={'YYYY/MM/DD'}
          style={{ width: '100%' }}
          value={[range[0] ? dayjs(range[0]) : null, range[1] ? dayjs(range[1]) : null]}
          onChange={(values) =>
            setRange([values?.[0]?.toDate() ?? null, values?.[1]?.toDate() ?? null])
          }
        />
        <Text fontSize={12} type={'secondary'}>
          {footerNote}
        </Text>
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={submitting} onClick={close}>
          {t('analysis.modal.cancel')}
        </Button>
        <Button loading={submitting} type={'primary'} onClick={handleSubmit}>
          {t('analysis.modal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DateRangeContent.displayName = 'DateRangeContent';

export const createDateRangeModal = (): ModalInstance =>
  createModal({
    content: <DateRangeContent />,
    footer: null,
    maskClosable: true,
    title: i18nT('analysis.modal.title', { ns: 'memory' }),
  });
