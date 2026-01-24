'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { App } from 'antd';
import { CalendarClockIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryAnalysisAsyncTask } from '@/app/[variants]/(main)/memory/features/MemoryAnalysis/useTask';
import { memoryExtractionService } from '@/services/userMemory/extraction';

import DateRangeModal from './DateRangeModal';

interface Props {
  footerNote: string;
  onRangeChange: (range: [Date | null, Date | null]) => void;
  range: [Date | null, Date | null];
}

const AnalysisTrigger = memo<Props>(({ footerNote, range, onRangeChange }) => {
  const { t } = useTranslation('memory');
  const { message } = App.useApp();
  const { isValidating, refresh } = useMemoryAnalysisAsyncTask();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

      setOpen(false);
    } catch (error) {
      console.error(error);
      message.error(t('analysis.toast.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        icon={<Icon icon={CalendarClockIcon} />}
        loading={submitting || isValidating}
        onClick={() => setOpen(true)}
        size={'large'}
        type={'primary'}
        style={{ maxWidth: 300 }}
      >
        {t('analysis.action.button')}
      </Button>

      <DateRangeModal
        footerNote={footerNote}
        open={open}
        onCancel={() => setOpen(false)}
        onChange={onRangeChange}
        onSubmit={handleSubmit}
        range={range}
        submitting={submitting}
      />
    </>
  );
});

AnalysisTrigger.displayName = 'AnalysisTrigger';

export default AnalysisTrigger;
