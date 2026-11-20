'use client';

import { Button, Empty, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ImportIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CaseTable from '@/features/LobeBench/CaseTable';
import { datasetsOf, isViewDataset, libraryOf, nativeCaseId } from '@/features/LobeBench/lobeBench';
import { useImportLobeBenchDataset } from '@/features/LobeBench/useImportDataset';
import { useLobeBenchBenchmarks, useLobeBenchDatasets } from '@/features/LobeBench/useLobeBench';
import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
});

/**
 * Compatibility view for previously installed library cases. New datasets
 * can be imported directly without installing a shared library.
 */
const LobeBenchLibrary = memo(() => {
  const { t } = useTranslation('eval');
  const importDataset = useImportLobeBenchDataset();
  const { benchmarks } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const library = libraryOf(datasets);
  // Cases that are also in a built-in dataset of library cases carry its name (Hard 50).
  const views = useMemo(() => datasetsOf(datasets).filter(isViewDataset), [datasets]);
  const viewIds = useMemo(() => views.map((view) => view.id), [views]);
  const { data: viewCases } = useEvalStore.getState().useFetchCasesByDataset(viewIds);
  const memberships = useMemo(() => {
    if (!viewCases) return;
    const names: Record<string, string[]> = {};
    for (const view of views) {
      for (const item of viewCases[view.id] ?? []) {
        (names[nativeCaseId(item)] ??= []).push(view.name);
      }
    }
    return names;
  }, [viewCases, views]);

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox gap={4}>
        <Text as={'h1'} fontSize={24} weight={600}>
          {t('lobeBench.library.title')}
        </Text>
        <Text type={'secondary'}>{t('lobeBench.library.subtitle')}</Text>
      </Flexbox>

      {library ? (
        <CaseTable
          selectable
          benchmarkIds={benchmarkIds}
          dataset={library}
          memberships={memberships}
        />
      ) : (
        <Empty description={t('lobeBench.library.empty')}>
          <Button
            icon={ImportIcon}
            style={{ marginTop: 16 }}
            type="primary"
            onClick={() => importDataset()}
          >
            {t('dataset.import.title')}
          </Button>
        </Empty>
      )}
    </Flexbox>
  );
});

LobeBenchLibrary.displayName = 'LobeBenchLibrary';

export default LobeBenchLibrary;
