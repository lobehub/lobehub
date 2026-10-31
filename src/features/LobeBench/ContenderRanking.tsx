'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { formatCost } from '@lobechat/utils';
import { Block, Button, Flexbox, Select, Text, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import {
  pickRankedSet,
  rankContenders,
  type RankedContender,
} from '@/features/LobeBench/benchmarkRanking';
import {
  formatPercent,
  LOBE_BENCH_PATH,
  RANK_ATTEMPTS,
  type RankableSet,
} from '@/features/LobeBench/lobeBench';
import { adaptBrandColor, findBrandColor } from '@/features/LobeBench/modelBrand';
import RankingBars, { type RankingBarRow } from '@/features/LobeBench/RankingBars';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';

const styles = stylex.create({
  title: {
    margin: 0,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBlock: 40,
    paddingInline: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

interface ContenderRankingProps {
  benchmarkId: string;
  runs: AgentEvalRunListItem[];
  /** The leaderboards ranked, one per benchmark (`rankableSetsOf`). */
  sets: RankableSet[];
}

const modelOf = (run: AgentEvalRunListItem) =>
  (run.config as { model?: string } | null | undefined)?.model;

/** The brand catalog of `@lobehub/icons`, loaded after paint like `ModelIcon` does. */
const useBrandCatalog = () =>
  useClientDataSWR(
    ['lobe-bench/model-brands'],
    async () => (await import('@lobehub/icons/es/features/modelConfig')).modelMappings,
  ).data;

/**
 * The benchmark page's headline: the models ranked by their best completed
 * run on one case set, in LobeBench's ranking form (see `RankingBars`). Every
 * value is written in the row, so nothing depends on hovering.
 */
const ContenderRanking = ({ benchmarkId, runs, sets }: ContenderRankingProps) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const theme = useTheme();
  const brands = useBrandCatalog();
  const [chosen, setChosen] = useState<string>();

  const rankings = useMemo(
    () => new Map(sets.map((set) => [set.id, rankContenders(runs, set)])),
    [runs, sets],
  );
  const set =
    (chosen && sets.find((candidate) => candidate.id === chosen)) || pickRankedSet(sets, rankings);
  const ranking = set ? rankings.get(set.id) : undefined;
  const contenders = ranking?.contenders ?? [];

  const describe = (entry: RankedContender) =>
    [
      entry.attempts > entry.k &&
        t('lobeBench.benchmark.rank.estimated', { attempts: entry.attempts }),
      t('lobeBench.overview.passedOf', { passed: entry.passed, total: entry.total }),
      entry.perCaseCost !== undefined &&
        t('lobeBench.benchmark.rank.cost', { cost: formatCost(entry.perCaseCost) }),
      entry.errors > 0 && t('lobeBench.dashboard.col.errors', { count: entry.errors }),
    ]
      .filter(Boolean)
      .join(' · ');

  const rows: RankingBarRow[] = contenders.map((entry, index) => {
    const model = modelOf(entry.run);
    const brand = findBrandColor(brands, model);
    const anyRate = entry.k > 1 && entry.total ? (entry.anyK ?? 0) / entry.total : undefined;
    return {
      color: brand ? adaptBrandColor(brand, theme.isDarkMode) : undefined,
      detail: describe(entry),
      icon: model ? <ModelIcon model={model} size={20} /> : undefined,
      key: entry.run.id,
      name: entry.name,
      rank: index + 1,
      rate: entry.passRate,
      reach: anyRate,
      reachText:
        anyRate === undefined
          ? undefined
          : t('lobeBench.benchmark.rank.anyRate', { k: entry.k, value: formatPercent(anyRate) }),
    };
  });

  const notes = [
    ranking &&
      ranking.active > 0 &&
      t('lobeBench.benchmark.rank.active', { count: ranking.active }),
    ranking &&
      ranking.unjudged > 0 &&
      t('lobeBench.benchmark.rank.unjudged', { count: ranking.unjudged }),
    ranking &&
      ranking.broken > 0 &&
      t('lobeBench.benchmark.rank.broken', { count: ranking.broken }),
    ranking &&
      ranking.outdated > 0 &&
      t('lobeBench.benchmark.rank.outdated', { count: ranking.outdated }),
    ranking &&
      ranking.fewAttempts > 0 &&
      t('lobeBench.benchmark.rank.fewAttempts', { count: ranking.fewAttempts, k: RANK_ATTEMPTS }),
  ].filter(Boolean) as string[];

  const startExperiment = () =>
    navigate(`${LOBE_BENCH_PATH}/experiments/new${set ? `?dataset=${set.id}` : ''}`);

  // A click opens the run where Lobe Bench reads it (its experiment, with the
  // same pass^k numbers); a run without one opens the Lab's view.
  const openRow = (row: RankingBarRow) => {
    const entry = contenders.find((candidate) => candidate.run.id === row.key);
    if (!entry) return;
    navigate(
      entry.run.experimentId
        ? `${LOBE_BENCH_PATH}/experiments/${entry.run.experimentId}`
        : `/eval/bench/${benchmarkId}/runs/${entry.run.id}`,
    );
  };

  return (
    <Block gap={16} padding={20} variant={'outlined'}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <h2 {...stylex.props(styles.title)}>{t('lobeBench.benchmark.rank.title')}</h2>
          <Text fontSize={12} type={'secondary'}>
            {t('lobeBench.benchmark.rank.hint', { k: RANK_ATTEMPTS })}
          </Text>
        </Flexbox>
        {sets.length > 1 && (
          <Select
            size={'small'}
            style={{ flex: 'none', width: 240 }}
            value={set?.id}
            options={sets.map((candidate) => ({
              label: t('lobeBench.benchmark.rank.setOption', {
                count: rankings.get(candidate.id)?.contenders.length ?? 0,
                name: candidate.name,
              }),
              value: candidate.id,
            }))}
            onChange={(value) => setChosen(value as string)}
          />
        )}
      </Flexbox>

      {contenders.length === 0 ? (
        <Flexbox {...stylex.props(styles.empty)}>
          <Text style={{ textAlign: 'center' }} type={'secondary'}>
            {t('lobeBench.benchmark.rank.empty', { set: set?.name ?? '—' })}
          </Text>
          {notes.length > 0 && (
            <Text fontSize={12} type={'secondary'}>
              {notes.join(' · ')}
            </Text>
          )}
          <Button icon={Plus} size={'small'} type={'primary'} onClick={startExperiment}>
            {t('lobeBench.benchmark.newExperiment')}
          </Button>
        </Flexbox>
      ) : (
        <>
          <RankingBars
            legendRate={t('lobeBench.benchmark.rank.legend.rate', { k: RANK_ATTEMPTS })}
            legendReach={t('lobeBench.benchmark.rank.legend.reach', { k: RANK_ATTEMPTS })}
            rows={rows}
            onSelect={openRow}
          />
          <Text fontSize={12} type={'secondary'}>
            {[
              t('lobeBench.benchmark.rank.summary', {
                count: contenders.length,
                runs: ranking?.ranked ?? 0,
              }),
              ...notes,
            ].join(' · ')}
          </Text>
        </>
      )}
    </Block>
  );
};

export default ContenderRanking;
