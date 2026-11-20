'use client';

import { Flexbox, InputNumber, Segmented, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { K_OPTIONS, type LobeBenchProtocol } from '@/features/LobeBench/lobeBench';
import ModelSelect from '@/features/ModelSelect';

export interface BenchmarkStandard {
  judge?: { model: string; provider: string };
  protocol: LobeBenchProtocol;
}

/** Whether a new benchmark's judge and run rules are all set. */
export const isCompleteStandard = (value: BenchmarkStandard) =>
  !!value.judge &&
  value.protocol.k >= 1 &&
  value.protocol.maxSteps >= 1 &&
  value.protocol.timeoutMinutes >= 1;

interface BenchmarkStandardFieldsProps {
  disabled?: boolean;
  onChange: (value: BenchmarkStandard) => void;
  value: BenchmarkStandard;
}

/**
 * What a new benchmark fixes for every run on it, so its scores stay
 * comparable: the judge model, attempts per case, step limit and timeout.
 * None of them can be changed afterwards, nor chosen per experiment.
 */
const BenchmarkStandardFields = memo<BenchmarkStandardFieldsProps>(
  ({ disabled, onChange, value }) => {
    const { t } = useTranslation('eval');
    const setProtocol = (patch: Partial<LobeBenchProtocol>) =>
      onChange({ ...value, protocol: { ...value.protocol, ...patch } });

    return (
      <Flexbox gap={12}>
        <Flexbox gap={2}>
          <Text weight={500}>{t('lobeBench.benchmark.standard.title')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.benchmark.standard.hint')}
          </Text>
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13}>{t('lobeBench.benchmark.create.judge')}</Text>
          <ModelSelect
            disabled={disabled}
            placeholder={t('lobeBench.benchmark.create.judge.placeholder')}
            value={value.judge}
            onChange={(judge) => onChange({ ...value, judge })}
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13}>{t('lobeBench.benchmark.standard.k')}</Text>
          <Segmented
            disabled={disabled}
            value={String(value.protocol.k)}
            options={K_OPTIONS.map((option) => ({
              label: t('lobeBench.new.k.times', { k: option }),
              value: String(option),
            }))}
            onChange={(k) => setProtocol({ k: Number(k) })}
          />
        </Flexbox>
        <Flexbox horizontal gap={12}>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13}>{t('lobeBench.new.maxSteps')}</Text>
            <InputNumber
              disabled={disabled}
              max={500}
              min={1}
              precision={0}
              style={{ width: '100%' }}
              value={value.protocol.maxSteps}
              onChange={(maxSteps) => setProtocol({ maxSteps: Number(maxSteps) || 0 })}
            />
          </Flexbox>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13}>{t('lobeBench.new.timeout')}</Text>
            <InputNumber
              disabled={disabled}
              max={240}
              min={1}
              precision={0}
              style={{ width: '100%' }}
              value={value.protocol.timeoutMinutes}
              onChange={(timeoutMinutes) =>
                setProtocol({ timeoutMinutes: Number(timeoutMinutes) || 0 })
              }
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

BenchmarkStandardFields.displayName = 'LobeBenchBenchmarkStandardFields';

export default BenchmarkStandardFields;
