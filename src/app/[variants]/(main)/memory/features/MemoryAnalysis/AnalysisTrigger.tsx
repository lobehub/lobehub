'use client';

import { ActionIcon, Button, Icon, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { CalendarClockIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryAnalysisAsyncTask } from '@/app/[variants]/(main)/memory/features/MemoryAnalysis/useTask';
import { memoryExtractionService } from '@/services/userMemory/extraction';

import DateRangeModal from './DateRangeModal';

interface Props {
  footerNote: string;
  iconOnly?: boolean;
  onRangeChange: (range: [Date | null, Date | null]) => void;
  range: [Date | null, Date | null];
}

const AnalysisTrigger = memo<Props>(({ footerNote, range, onRangeChange, iconOnly }) => {
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

  const loading = submitting || isValidating;

  return (
    <>
      {iconOnly ? (
        <Tooltip title={t('analysis.action.button')}>
          <ActionIcon icon={CalendarClockIcon} loading={loading} onClick={() => setOpen(true)} />
        </Tooltip>
      ) : (
        <Button
          icon={<Icon icon={CalendarClockIcon} />}
          loading={loading}
          size={'large'}
          style={{ maxWidth: 300 }}
          type={'primary'}
          onClick={() => setOpen(true)}
        >
          {t('analysis.action.button')}
        </Button>
      )}

      <DateRangeModal
        footerNote={footerNote}
        open={open}
        range={range}
        submitting={submitting}
        onCancel={() => setOpen(false)}
        onChange={onRangeChange}
        onSubmit={handleSubmit}
      />
    </>
  );
});

AnalysisTrigger.displayName = 'AnalysisTrigger';

export default AnalysisTrigger;
