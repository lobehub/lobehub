'use client';

import { Flexbox, Input } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGoalStore } from '@/store/goal';

/**
 * Manually record one measurement against a declared clause. The probe Work is
 * the automated writer; this is the human's entry for numbers only they can
 * see — and the server advances the goal when the observation clears the gate.
 */
const RecordObservationContent = memo<{ goalId: string; metricKey: string; metricTitle?: string }>(
  ({ goalId, metricKey, metricTitle }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const recordGoalObservation = useGoalStore((s) => s.recordGoalObservation);

    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || value.trim() === '' || busy) return;
      setBusy(true);
      try {
        // The clause's display name rides along so the series created by the
        // first observation carries it too.
        await recordGoalObservation(goalId, { key: metricKey, title: metricTitle, value: parsed });
        close();
      } catch (error) {
        console.error('[NorthStar] failed to record observation:', error);
        toast.error(t('goalProcess.northStar.record.failed'));
      } finally {
        setBusy(false);
      }
    };

    return (
      <Flexbox gap={16} paddingBlock={'4px 8px'}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('goalProcess.northStar.record.valueLabel', { key: metricKey })}
          </Text>
          <Input
            autoFocus
            placeholder={'42180'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPressEnter={() => void submit()}
          />
        </Flexbox>
        <Flexbox horizontal justify={'flex-end'}>
          <Button
            disabled={!Number.isFinite(Number(value)) || value.trim() === ''}
            loading={busy}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t('goalProcess.northStar.record.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

RecordObservationContent.displayName = 'RecordObservationContent';

export const openRecordObservationModal = (
  goalId: string,
  metricKey: string,
  metricTitle?: string,
): ModalInstance =>
  createModal({
    content: (
      <RecordObservationContent goalId={goalId} metricKey={metricKey} metricTitle={metricTitle} />
    ),
    footer: null,
    maskClosable: true,
    title: t('goalProcess.northStar.record.title', { ns: 'chat' }),
    width: 'min(90%, 420px)',
  });
