'use client';

import type { AgentEvalDatasetPackagePreview } from '@lobechat/types';
import { Flexbox, Input, Select, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  sample: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    paddingBlockStart: 12,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  samples: { maxHeight: 200, overflowY: 'auto' },
});

export interface DatasetPackageBenchmark {
  id: string;
  name: string;
}

interface DatasetPackagePreviewProps {
  benchmarkId?: string;
  benchmarkName: string;
  benchmarks: DatasetPackageBenchmark[];
  disabled?: boolean;
  existingDataset?: boolean;
  name: string;
  onBenchmarkIdChange: (id: string | undefined) => void;
  onBenchmarkNameChange: (name: string) => void;
  onNameChange: (name: string) => void;
  preview: AgentEvalDatasetPackagePreview;
  samples: Array<{ input?: unknown }>;
}

/** A structured package already contains its case fields, rules and environments. */
export const DatasetPackagePreview = ({
  benchmarkId,
  benchmarkName,
  benchmarks,
  disabled,
  existingDataset,
  name,
  onBenchmarkIdChange,
  onBenchmarkNameChange,
  onNameChange,
  preview,
  samples,
}: DatasetPackagePreviewProps) => {
  const { t } = useTranslation('eval');
  const id = useId();

  return (
    <Flexbox gap={20}>
      <Flexbox gap={8}>
        <Text weight={600}>{t('dataset.import.package.preview')}</Text>
        {preview.description && <Text type="secondary">{preview.description}</Text>}
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag>{t('dataset.import.package.cases', { count: preview.caseCount })}</Tag>
          <Tag>{t('dataset.import.package.environments', { count: preview.environmentCount })}</Tag>
          {preview.release && (
            <Tag>{t('lobeBench.dataset.release', { release: preview.release })}</Tag>
          )}
        </Flexbox>
        <Text fontSize={13} type="secondary">
          {t('dataset.import.package.preserved')}
        </Text>
        {preview.mockServices.length > 0 && (
          <Text fontSize={13} type="secondary">
            {t('dataset.import.package.mockServices', {
              services: preview.mockServices.join(', '),
            })}
          </Text>
        )}
      </Flexbox>

      {!existingDataset && (
        <>
          <Flexbox gap={8}>
            <label htmlFor={`${id}-name`}>{t('dataset.import.package.name')}</label>
            <Input
              disabled={disabled}
              id={`${id}-name`}
              maxLength={200}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={8}>
            <label htmlFor={`${id}-benchmark`}>{t('dataset.import.package.benchmark')}</label>
            <Select
              disabled={disabled}
              id={`${id}-benchmark`}
              value={benchmarkId ?? '__new__'}
              options={[
                { label: t('dataset.import.package.newBenchmark'), value: '__new__' },
                ...benchmarks.map((benchmark) => ({ label: benchmark.name, value: benchmark.id })),
              ]}
              onChange={(value) =>
                onBenchmarkIdChange(
                  typeof value === 'string' && value !== '__new__' ? value : undefined,
                )
              }
            />
          </Flexbox>
          {!benchmarkId && (
            <Flexbox gap={8}>
              <label htmlFor={`${id}-benchmark-name`}>
                {t('dataset.import.package.benchmarkName')}
              </label>
              <Input
                disabled={disabled}
                id={`${id}-benchmark-name`}
                maxLength={200}
                value={benchmarkName}
                onChange={(e) => onBenchmarkNameChange(e.target.value)}
              />
            </Flexbox>
          )}
        </>
      )}

      <Flexbox gap={12}>
        <Text weight={500}>{t('dataset.import.preview')}</Text>
        <Flexbox className={stylex.props(styles.samples).className} gap={12}>
          {samples.slice(0, 3).map((sample, index) => (
            <Text className={stylex.props(styles.sample).className} fontSize={13} key={index}>
              {String(sample.input ?? '')}
            </Text>
          ))}
        </Flexbox>
        <Text fontSize={13} type="secondary">
          {t('dataset.import.package.history')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
};
