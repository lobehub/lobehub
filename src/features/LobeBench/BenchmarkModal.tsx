'use client';

import {
  Button,
  createModal,
  Flexbox,
  Input,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { moveDatasets } from '@/features/LobeBench/datasetCases';
import { caseCountOf, LOBE_BENCH_KIND } from '@/features/LobeBench/lobeBench';
import { useEvalStore } from '@/store/eval';

interface DatasetOption {
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  testCaseCount?: number | null;
}

interface CreateBenchmarkFormProps {
  /** The account's datasets in no benchmark of its own, that the new one can be made of. */
  datasets: DatasetOption[];
  onCreated?: (benchmarkId: string) => void;
}

/**
 * Makes a benchmark of the account's own datasets. It has
 * no judge, mock or defaults of its own: its datasets run on the library, under
 * the library benchmark's settings. Datasets are made first, in the Case
 * library; a benchmark only chooses among them.
 */
const CreateBenchmarkForm = memo<CreateBenchmarkFormProps>(({ datasets, onCreated }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const createBenchmark = useEvalStore((s) => s.createBenchmark);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const created = (await createBenchmark({
        description: description.trim() || undefined,
        identifier: `lobe-bench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        metadata: { kind: LOBE_BENCH_KIND },
        name: trimmed,
      })) as { data?: { id?: string }; id?: string };
      const id = created?.id ?? created?.data?.id;
      if (!id) throw new Error(t('lobeBench.benchmark.create.failed'));
      await moveDatasets(
        datasets.filter((dataset) => picked.includes(dataset.id)),
        id,
      );
      close();
      onCreated?.(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('lobeBench.benchmark.create.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.benchmark.create.name')}</Text>
        <Input
          autoFocus
          id={'lobe-bench-benchmark-name'}
          placeholder={t('lobeBench.benchmark.create.name.placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={submit}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.benchmark.create.description')}</Text>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          id={'lobe-bench-benchmark-description'}
          placeholder={t('lobeBench.benchmark.create.description.placeholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Text weight={500}>{t('lobeBench.benchmark.create.datasets')}</Text>
        {datasets.length > 0 ? (
          <>
            <Select
              id={'lobe-bench-benchmark-datasets'}
              mode={'multiple'}
              placeholder={t('lobeBench.benchmark.create.datasets.placeholder')}
              value={picked}
              options={datasets.map((dataset) => ({
                label: `${dataset.name} · ${t('lobeBench.new.dataset.cases', {
                  count: caseCountOf(dataset),
                })}`,
                value: dataset.id,
              }))}
              onChange={(value) => setPicked(value as string[])}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('lobeBench.benchmark.create.datasets.hint')}
            </Text>
          </>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.benchmark.create.datasets.empty')}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('common.cancel')}</Button>
        <Button disabled={!name.trim()} loading={saving} type={'primary'} onClick={submit}>
          {t('lobeBench.benchmark.create.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateBenchmarkForm.displayName = 'LobeBenchCreateBenchmarkForm';

/** Opens the dialog that makes a benchmark of the account's datasets. */
export const openCreateBenchmarkModal = (props: CreateBenchmarkFormProps) =>
  createModal({
    content: <CreateBenchmarkForm {...props} />,
    footer: null,
    title: translate('lobeBench.benchmark.create.title', { ns: 'eval' }),
    width: 480,
  });
