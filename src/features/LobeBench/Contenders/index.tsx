'use client';

import { evalCaseVersionOf } from '@lobechat/types';
import { Block, Button, confirmModal, Empty, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { rankContenders } from '@/features/LobeBench/benchmarkRanking';
import { openContenderModal } from '@/features/LobeBench/ContenderForm';
import {
  describeSettings,
  experimentPartsOf,
  formatPercent,
  isBuiltInBenchmark,
  isLobeBenchMeta,
  type LobeBenchContender,
  sameContender,
  upsertContenders,
} from '@/features/LobeBench/lobeBench';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchExperiments,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';
import { useSavedContenders } from '@/features/LobeBench/useSavedContenders';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  table: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.4fr) 100px 120px 140px',
    columnGap: 12,
    alignItems: 'center',
  },
  head: {
    paddingBlock: 8,
    paddingInline: 12,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  row: {
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
});

/**
 * The account's contenders: every model-plus-settings that ran before, kept
 * so the next experiment is one click, with how often each ran and its best
 * result on a whole case set.
 */
const LobeBenchContenders = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmark, contenders, save } = useSavedContenders();
  const builtIn = isBuiltInBenchmark(benchmark);
  const { benchmarks } = useLobeBenchBenchmarks();
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { experiments } = useLobeBenchExperiments();
  const { data: runs } = useLobeBenchRuns(benchmarkIds);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const labels = {
    reasoning: t('lobeBench.contender.settings.reasoning'),
    temperature: t('lobeBench.contender.settings.temperature'),
    topP: t('lobeBench.contender.settings.topP'),
  };

  const experimentsOf = (contender: LobeBenchContender) =>
    experiments.filter(
      (experiment) =>
        isLobeBenchMeta(experiment.metadata) &&
        experiment.metadata.contenders.some((c) => sameContender(c, contender)),
    ).length;

  // Best pass rate among completed runs on a whole set that this contender made, on
  // the current version of its cases (earlier versions are history, not a result).
  const bestOf = (contender: LobeBenchContender) => {
    const ids = new Set(
      experiments.flatMap((experiment) => {
        const meta = experiment.metadata;
        if (!isLobeBenchMeta(meta)) return [];
        // Its run on every dataset the experiment covers.
        const parts = experimentPartsOf(meta);
        return meta.contenders
          .filter((c) => sameContender(c, contender))
          .flatMap((c) => parts.flatMap((part) => part.runIds?.[c.id] ?? []));
      }),
    );
    const contenderRuns = (runs ?? []).filter((run) => ids.has(run.id));
    const rates = (datasets ?? []).flatMap((dataset) =>
      rankContenders(contenderRuns, {
        id: dataset.id,
        caseVersion: evalCaseVersionOf(dataset.metadata),
      }).contenders.map((entry) => entry.passRate),
    );
    return rates.length > 0 ? Math.max(...rates) : undefined;
  };

  const persist = async (list: LobeBenchContender[]) => {
    try {
      await save(list);
      toast.success(t('lobeBench.contenders.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const add = () =>
    openContenderModal(
      (contender) => persist(upsertContenders(contenders, [contender])),
      t('lobeBench.contenders.new'),
      t('lobeBench.contender.save.list'),
    );
  const edit = (contender: LobeBenchContender) =>
    openContenderModal(
      (edited) => persist(contenders.map((c) => (c.id === contender.id ? edited : c))),
      t('lobeBench.contenders.edit'),
      t('lobeBench.contender.save.list'),
      contender,
    );
  const remove = (contender: LobeBenchContender) =>
    confirmModal({
      content: t('lobeBench.contenders.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('lobeBench.case.delete'),
      onOk: () => persist(contenders.filter((c) => c.id !== contender.id)),
      title: t('lobeBench.case.delete'),
    });

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1} gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
        <Flexbox gap={4}>
          <Text as={'h1'} fontSize={24} weight={600}>
            {t('lobeBench.contenders.title')}
          </Text>
          <Text type={'secondary'}>
            {builtIn ? t('lobeBench.contenders.builtIn') : t('lobeBench.contenders.subtitle')}
          </Text>
        </Flexbox>
        {!builtIn && (
          <Button icon={Plus} type={'primary'} onClick={add}>
            {t('lobeBench.contenders.new')}
          </Button>
        )}
      </Flexbox>

      <Block padding={8} variant={'outlined'}>
        <Flexbox gap={2}>
          <div className={stylex.props(styles.table, styles.head).className}>
            <span>{t('lobeBench.contenders.col.name')}</span>
            <span>{t('lobeBench.contenders.col.model')}</span>
            <span style={{ textAlign: 'right' }}>{t('lobeBench.contenders.col.experiments')}</span>
            <span style={{ textAlign: 'right' }}>{t('lobeBench.contenders.col.best')}</span>
            <span />
          </div>
          {contenders.length === 0 && <Empty description={t('lobeBench.contenders.empty')} />}
          {contenders.map((contender) => {
            const best = bestOf(contender);
            return (
              <div className={stylex.props(styles.table, styles.row).className} key={contender.id}>
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {contender.name}
                  </Text>
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {describeSettings(contender.params, contender.chatConfig, labels) ||
                      t('lobeBench.contender.settings.default')}
                  </Text>
                </Flexbox>
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {contender.model} · {contender.provider}
                </Text>
                <Text
                  className={stylex.props(styles.mono).className}
                  style={{ textAlign: 'right' }}
                >
                  {experimentsOf(contender)}
                </Text>
                <Text
                  className={stylex.props(styles.mono).className}
                  style={{ textAlign: 'right' }}
                >
                  {best === undefined ? '—' : formatPercent(best)}
                </Text>
                <Flexbox horizontal gap={4} justify={'flex-end'}>
                  {!builtIn && (
                    <>
                      <Button size={'small'} type={'text'} onClick={() => edit(contender)}>
                        {t('lobeBench.contenders.edit')}
                      </Button>
                      <Button danger size={'small'} type={'text'} onClick={() => remove(contender)}>
                        {t('lobeBench.case.delete')}
                      </Button>
                    </>
                  )}
                </Flexbox>
              </div>
            );
          })}
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

LobeBenchContenders.displayName = 'LobeBenchContenders';

export default LobeBenchContenders;
