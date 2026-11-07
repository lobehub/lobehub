'use client';

import { Button, createModal, Flexbox, Input, Text, toast, useModalContext } from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createDataset, renameDataset } from '@/features/LobeBench/datasetCases';
import { type LobeBenchCase } from '@/features/LobeBench/useLobeBench';

/** The library a new dataset takes its mock, judge and case version from. */
interface LibraryOption {
  evalConfig?: unknown;
  evalMode?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface PicksDatasetOption {
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  testCaseCount?: number | null;
}

interface CreateDatasetFormProps {
  /** The benchmark the dataset is filed under until a benchmark of the account's takes it. */
  benchmarkId: string;
  /** The checked library cases, copied in. */
  cases: LobeBenchCase[];
  library?: LibraryOption;
  onDone?: (dataset: { id: string; name: string }) => void;
}

/**
 * Makes a dataset of the account's from checked library cases. Its cases are
 * fixed from then on: another set of cases is another
 * dataset, so the runs on this one keep meaning what they meant.
 */
const CreateDatasetForm = memo<CreateDatasetFormProps>(
  ({ benchmarkId, cases, library, onDone }) => {
    const { t } = useTranslation('eval');
    const { close } = useModalContext();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
      setSaving(true);
      try {
        const datasetName = name.trim() || t('lobeBench.picks.defaultName');
        const created = await createDataset(benchmarkId, datasetName, library, cases);
        toast.success(t('lobeBench.picks.created', { count: cases.length, dataset: datasetName }));
        close();
        onDone?.({ id: created.id, name: datasetName });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('lobeBench.picks.failed'));
      } finally {
        setSaving(false);
      }
    };

    return (
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Text weight={500}>{t('lobeBench.picks.name')}</Text>
          <Input
            autoFocus
            id={'lobe-bench-picks-name'}
            placeholder={t('lobeBench.picks.name.placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={submit}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.picks.fixed')}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button loading={saving} type={'primary'} onClick={submit}>
            {t('lobeBench.picks.create')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

CreateDatasetForm.displayName = 'LobeBenchCreateDatasetForm';

/** Opens the dialog that makes a dataset of these library cases. */
export const openCreateDatasetModal = (props: CreateDatasetFormProps) =>
  createModal({
    content: <CreateDatasetForm {...props} />,
    footer: null,
    title: translate('lobeBench.picks.title', { count: props.cases.length, ns: 'eval' }),
    width: 480,
  });

interface RenameDatasetFormProps {
  dataset: PicksDatasetOption;
  onSaved?: () => Promise<unknown> | void;
}

const RenameDatasetForm = memo<RenameDatasetFormProps>(({ dataset, onSaved }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const [name, setName] = useState(dataset.name);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await renameDataset(dataset, trimmed);
      await onSaved?.();
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('lobeBench.picks.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Input
        autoFocus
        id={'lobe-bench-dataset-name'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
      />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('common.cancel')}</Button>
        <Button disabled={!name.trim()} loading={saving} type={'primary'} onClick={submit}>
          {t('common.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RenameDatasetForm.displayName = 'LobeBenchRenameDatasetForm';

/** Opens the dialog that renames a dataset made of library cases. */
export const openRenameDatasetModal = (
  dataset: PicksDatasetOption,
  onSaved?: () => Promise<unknown> | void,
) =>
  createModal({
    content: <RenameDatasetForm dataset={dataset} onSaved={onSaved} />,
    footer: null,
    title: translate('lobeBench.picks.rename', { ns: 'eval' }),
    width: 420,
  });
