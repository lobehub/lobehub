'use client';

import {
  Button,
  createModal,
  Flexbox,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
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
    /** Record failure, shown above the submit button: the modal stays open with the typed value. */
    const [error, setError] = useState<InlineErrorState | null>(null);

    const submit = async () => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || value.trim() === '' || busy) return;
      setBusy(true);
      setError(null);
      try {
        // The clause's display name rides along so the series created by the
        // first observation carries it too.
        await recordGoalObservation(goalId, { key: metricKey, title: metricTitle, value: parsed });
        close();
      } catch (err) {
        console.error('[NorthStar] failed to record observation:', err);
        setError(toInlineError(t('goalProcess.northStar.record.failedRetry'), err));
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
            onPressEnter={() => void submit()}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        </Flexbox>
        {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
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
