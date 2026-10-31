'use client';

import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CaseTable from '@/features/LobeBench/CaseTable';
import { datasetsOf, isViewDataset, libraryOf, nativeCaseId } from '@/features/LobeBench/lobeBench';
import {
  fetchDatasetCases,
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
} from '@/features/LobeBench/useLobeBench';
import { useClientDataSWR } from '@/libs/swr';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
});

/**
 * The built-in case library: every case Lobe Bench ships, in one list. It is
 * not a dataset of its own to pick between; the account checks cases here
 * and makes a dataset of them, the only place a dataset is made.
 */
const LobeBenchLibrary = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarks } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const library = libraryOf(datasets);
  // Cases that are also in a built-in dataset of library cases carry its name (Hard 50).
  const views = useMemo(() => datasetsOf(datasets).filter(isViewDataset), [datasets]);
  const { data: memberships } = useClientDataSWR(
    views.length > 0 ? ['lobe-bench/memberships', ...views.map((view) => view.id)] : null,
    async () => {
      const names: Record<string, string[]> = {};
      for (const view of views) {
        for (const item of await fetchDatasetCases(view.id)) {
          (names[nativeCaseId(item)] ??= []).push(view.name);
        }
      }
      return names;
    },
  );

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox gap={4}>
        <Text as={'h1'} fontSize={24} weight={600}>
          {t('lobeBench.library.title')}
        </Text>
        <Text type={'secondary'}>{t('lobeBench.library.subtitle')}</Text>
      </Flexbox>

      <CaseTable
        selectable
        benchmarkIds={benchmarkIds}
        dataset={library}
        memberships={memberships}
      />
    </Flexbox>
  );
});

LobeBenchLibrary.displayName = 'LobeBenchLibrary';

export default LobeBenchLibrary;
