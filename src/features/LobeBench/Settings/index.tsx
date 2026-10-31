'use client';

import {
  Block,
  Button,
  Empty,
  Flexbox,
  Input,
  InputNumber,
  Segmented,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  clearExperimentDefaults,
  readExperimentDefaults,
  writeExperimentDefaults,
} from '@/features/LobeBench/experimentDefaults';
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MINUTES,
  getBenchmarkMeta,
  isBuiltInBenchmark,
  isCustomDataset,
  K_OPTIONS,
  type LobeBenchBenchmarkMeta,
  pickPrimaryBenchmark,
  settingsBenchmarkOf,
} from '@/features/LobeBench/lobeBench';
import { useLobeBenchBenchmarks, useLobeBenchDatasets } from '@/features/LobeBench/useLobeBench';
import ModelSelect from '@/features/ModelSelect';
import { useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  form: { width: '100%', maxWidth: 760 },
  status: { fontFamily: cssVar.fontFamilyCode, fontSize: 12 },
});

type Section = 'defaults' | 'judge' | 'mock';

type MockStatus = Awaited<ReturnType<typeof agentEvalService.checkBenchmarkMock>> | undefined;

interface BuiltInSettingsProps {
  benchmark: { id: string; metadata?: Record<string, unknown> | null };
  benchmarks: { id: string; name: string }[];
  checking: boolean;
  mockStatus: MockStatus;
  onSelectBenchmark: (id: string) => void;
  recheck: () => void;
}

/**
 * The built-in benchmark comes with its grader and its simulated services;
 * the only thing a person sets here is what their own new experiments start
 * with. Written for someone who runs experiments, not for whoever installed it.
 */
const BuiltInSettings = memo<BuiltInSettingsProps>(
  ({ benchmark, benchmarks, checking, mockStatus, onSelectBenchmark, recheck }) => {
    const { t } = useTranslation('eval');
    const meta = getBenchmarkMeta(benchmark);
    const { data: datasets } = useLobeBenchDatasets(useMemo(() => [benchmark.id], [benchmark.id]));
    const stored = readExperimentDefaults(benchmark.id);
    const [k, setK] = useState(stored?.k ?? meta.defaults?.k ?? 1);
    const [maxSteps, setMaxSteps] = useState<number | null>(
      stored?.maxSteps ?? meta.defaults?.maxSteps ?? DEFAULT_MAX_STEPS,
    );
    const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(
      stored?.timeoutMinutes ?? meta.defaults?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
    );

    // One line per case set: the simulation that serves it and whether it answers. The mock at
    // the benchmark's base URL serves its own set (`mock.dataset`); any other set must be listed
    // under the mock's `upstreams`, otherwise its tool calls have nowhere to go.
    const nativeDataset = (benchmark.metadata as { mock?: { dataset?: string } } | null | undefined)
      ?.mock?.dataset;
    const setLines = (datasets ?? [])
      .filter((d) => !isCustomDataset(d))
      .map((d) => {
        const mockDataset = (d.metadata as { mock?: { dataset?: string } } | null)?.mock?.dataset;
        const upstream =
          mockStatus?.configured && mockDataset && mockStatus.upstreams?.[mockDataset]
            ? mockStatus.upstreams[mockDataset]
            : undefined;
        const native = !mockDataset || mockDataset === nativeDataset;
        const online = upstream
          ? upstream.ok
          : native && !!(mockStatus?.configured && mockStatus.ok);
        // The cases that can run are the set's own; the engine behind it may serve more
        // (the full Release, multi-turn cases included) without them being in the set.
        const cases = d.testCaseCount ?? upstream?.cases ?? 0;
        return { cases, id: d.id, name: d.name, online };
      });
    const simulationOnline = !!(
      mockStatus?.configured &&
      mockStatus.ok &&
      mockStatus.tokenConfigured
    );

    const saveMine = () => {
      writeExperimentDefaults(benchmark.id, {
        k,
        maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
        timeoutMinutes: timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      });
      toast.success(t('lobeBench.settings.mine.saved'));
    };
    const resetMine = () => {
      clearExperimentDefaults(benchmark.id);
      setK(meta.defaults?.k ?? 1);
      setMaxSteps(meta.defaults?.maxSteps ?? DEFAULT_MAX_STEPS);
      setTimeoutMinutes(meta.defaults?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES);
      toast.success(t('lobeBench.settings.mine.reset.done'));
    };

    return (
      <Flexbox className={stylex.props(styles.container).className} flex={1}>
        <Flexbox className={stylex.props(styles.form).className} gap={24}>
          <Flexbox gap={4}>
            <Text as={'h1'} fontSize={24} weight={600}>
              {t('lobeBench.settings.title')}
            </Text>
            <Text type={'secondary'}>{t('lobeBench.settings.subtitle')}</Text>
          </Flexbox>

          {benchmarks.length > 1 && (
            <Flexbox gap={6}>
              <Text weight={500}>{t('lobeBench.settings.benchmark')}</Text>
              <Segmented
                options={benchmarks.map((b) => ({ label: b.name, value: b.id }))}
                value={benchmark.id}
                onChange={(value) => onSelectBenchmark(value as string)}
              />
            </Flexbox>
          )}

          <Block padding={16} variant={'outlined'}>
            <Flexbox gap={6}>
              <Text weight={600}>{t('lobeBench.settings.grading.title')}</Text>
              <Text>
                {meta.judge
                  ? t('lobeBench.settings.grading.line', { model: meta.judge.model })
                  : t('lobeBench.settings.grading.unset')}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.settings.grading.hint')}
              </Text>
            </Flexbox>
          </Block>

          <Block padding={16} variant={'outlined'}>
            <Flexbox gap={10}>
              <Flexbox gap={2}>
                <Text weight={600}>{t('lobeBench.settings.sim.title')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.settings.sim.hint')}
                </Text>
              </Flexbox>
              <Flexbox gap={4}>
                <Text
                  weight={500}
                  style={{
                    color: simulationOnline ? cssVar.colorSuccessText : cssVar.colorWarningText,
                  }}
                >
                  {!mockStatus
                    ? '…'
                    : simulationOnline
                      ? t('lobeBench.settings.sim.online')
                      : mockStatus.configured && mockStatus.ok
                        ? t('lobeBench.settings.sim.noToken')
                        : t('lobeBench.settings.sim.offline')}
                </Text>
                {mockStatus &&
                  setLines.map((line) => (
                    <Text fontSize={12} key={line.id} type={'secondary'}>
                      {line.online
                        ? t('lobeBench.settings.sim.set', { cases: line.cases, name: line.name })
                        : t('lobeBench.settings.sim.setDown', { name: line.name })}
                    </Text>
                  ))}
              </Flexbox>
              <Flexbox horizontal>
                <Button loading={checking} onClick={recheck}>
                  {t('lobeBench.benchmark.mock.retry')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>

          <Block padding={16} variant={'outlined'}>
            <Flexbox gap={12}>
              <Flexbox gap={2}>
                <Text weight={600}>{t('lobeBench.settings.mine.title')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('lobeBench.settings.mine.hint')}
                </Text>
              </Flexbox>
              <Flexbox gap={6}>
                <Text fontSize={13} weight={500}>
                  {t('lobeBench.settings.defaults.k')}
                </Text>
                <Segmented
                  value={String(k)}
                  options={K_OPTIONS.map((option) => ({
                    label: `${option}×`,
                    value: String(option),
                  }))}
                  onChange={(value) => setK(Number(value))}
                />
              </Flexbox>
              <Flexbox gap={6}>
                <Text fontSize={13} weight={500}>
                  {t('lobeBench.settings.defaults.maxSteps')}
                </Text>
                <InputNumber
                  max={1000}
                  min={1}
                  style={{ width: '100%' }}
                  value={maxSteps}
                  variant={'filled'}
                  onChange={(value) => setMaxSteps(value as number | null)}
                />
              </Flexbox>
              <Flexbox gap={6}>
                <Text fontSize={13} weight={500}>
                  {t('lobeBench.settings.defaults.timeout')}
                </Text>
                <InputNumber
                  max={240}
                  min={1}
                  style={{ width: '100%' }}
                  value={timeoutMinutes}
                  variant={'filled'}
                  onChange={(value) => setTimeoutMinutes(value as number | null)}
                />
              </Flexbox>
              <Flexbox horizontal gap={8} justify={'flex-end'}>
                <Button onClick={resetMine}>{t('lobeBench.settings.mine.reset')}</Button>
                <Button type={'primary'} onClick={saveMine}>
                  {t('lobeBench.settings.save')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Block>
        </Flexbox>
      </Flexbox>
    );
  },
);

BuiltInSettings.displayName = 'LobeBenchBuiltInSettings';

/**
 * Benchmark-level settings of Lobe Bench, kept in the benchmark's metadata:
 * the judge model attempts are graded with, the mock tool service their
 * connector calls go to, and what a new experiment starts with.
 */
const LobeBenchSettings = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarks: benchmarkList, isLoading } = useLobeBenchBenchmarks();
  // A benchmark made of library cases (Hard 50, the account's) runs on the library:
  // its settings are the library benchmark's, so it has none of its own here.
  const benchmarks = useMemo(
    () => benchmarkList.filter((b) => settingsBenchmarkOf(benchmarkList, b.id)?.id === b.id),
    [benchmarkList],
  );
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);
  const [benchmarkSel, setBenchmarkSel] = useState<string>();
  const benchmark =
    benchmarks.find((b) => b.id === benchmarkSel) ?? pickPrimaryBenchmark(benchmarks);
  const meta = getBenchmarkMeta(benchmark);
  // The built-in benchmark's settings were fixed when it was installed; the
  // page shows them and lets an experiment pick its own judge and limits.
  const builtIn = isBuiltInBenchmark(benchmark);

  const [judge, setJudge] = useState<{ model: string; provider: string }>();
  const [mockDataset, setMockDataset] = useState('');
  const [k, setK] = useState(1);
  const [maxSteps, setMaxSteps] = useState<number | null>(DEFAULT_MAX_STEPS);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(DEFAULT_TIMEOUT_MINUTES);
  const [saving, setSaving] = useState<Section>();

  // The form shows the selected benchmark's saved values.
  useEffect(() => {
    if (!benchmark) return;
    const current = getBenchmarkMeta(benchmark);
    setJudge(current.judge);
    setMockDataset(current.mock?.dataset ?? '');
    setK(current.defaults?.k ?? 1);
    setMaxSteps(current.defaults?.maxSteps ?? DEFAULT_MAX_STEPS);
    setTimeoutMinutes(current.defaults?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmark?.id]);

  const {
    data: mockStatus,
    isValidating: checking,
    mutate: recheck,
  } = useClientDataSWR(benchmark ? ['lobe-bench/mock-check', benchmark.id] : null, () =>
    agentEvalService.checkBenchmarkMock(benchmark!.id),
  );

  const save = async (section: Section, patch: Partial<LobeBenchBenchmarkMeta>) => {
    if (!benchmark) return;
    setSaving(section);
    try {
      await updateBenchmark({
        description: benchmark.description ?? undefined,
        id: benchmark.id,
        identifier: benchmark.identifier,
        metadata: { ...benchmark.metadata, ...patch },
        name: benchmark.name,
      });
      toast.success(t('lobeBench.settings.saved'));
      if ('mock' in patch) await recheck();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(undefined);
    }
  };

  const mockLine = !mockStatus
    ? '…'
    : !mockStatus.configured
      ? t('lobeBench.settings.mock.status.none')
      : mockStatus.ok
        ? `${t('lobeBench.settings.mock.status.ok', { status: mockStatus.status })} · ${
            mockStatus.tokenConfigured
              ? t('lobeBench.settings.mock.status.token')
              : t('lobeBench.settings.mock.status.noToken')
          }`
        : t('lobeBench.settings.mock.status.down', {
            error: mockStatus.error ?? `HTTP ${mockStatus.status}`,
          });
  const mockTone =
    mockStatus?.configured && mockStatus.ok && mockStatus.tokenConfigured
      ? cssVar.colorSuccessText
      : mockStatus
        ? cssVar.colorWarningText
        : cssVar.colorTextSecondary;

  if (builtIn && benchmark) {
    return (
      <BuiltInSettings
        benchmark={benchmark}
        benchmarks={benchmarks}
        checking={checking}
        mockStatus={mockStatus}
        recheck={() => recheck()}
        onSelectBenchmark={setBenchmarkSel}
      />
    );
  }

  if (!isLoading && benchmarks.length === 0) {
    return (
      <Flexbox className={stylex.props(styles.container).className} flex={1}>
        <Empty description={t('lobeBench.settings.notInstalled')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1}>
      <Flexbox className={stylex.props(styles.form).className} gap={24}>
        <Flexbox gap={4}>
          <Text as={'h1'} fontSize={24} weight={600}>
            {t('lobeBench.settings.title')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.settings.subtitle')}</Text>
        </Flexbox>

        {benchmarks.length > 1 && (
          <Flexbox gap={6}>
            <Text weight={500}>{t('lobeBench.settings.benchmark')}</Text>
            <Segmented
              options={benchmarks.map((b) => ({ label: b.name, value: b.id }))}
              value={benchmark?.id}
              onChange={(value) => setBenchmarkSel(value as string)}
            />
          </Flexbox>
        )}

        <Block padding={16} variant={'outlined'}>
          <Flexbox gap={12}>
            <Flexbox gap={2}>
              <Text weight={600}>{t('lobeBench.settings.judge')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.settings.judge.hint')}
              </Text>
            </Flexbox>
            {builtIn ? (
              // Shown as text: the picker only knows the models this account enabled, and
              // would call a server-provided judge "unavailable".
              <Text className={stylex.props(styles.status).className}>
                {judge
                  ? `${judge.model} · ${judge.provider}`
                  : t('lobeBench.settings.judge.placeholder')}
              </Text>
            ) : (
              <ModelSelect
                placeholder={t('lobeBench.settings.judge.placeholder')}
                value={judge}
                variant={'filled'}
                onChange={(value) => setJudge(value)}
              />
            )}
            <Flexbox horizontal gap={8} justify={'flex-end'}>
              {!builtIn && judge && (
                <Button
                  onClick={() => {
                    setJudge(undefined);
                    void save('judge', { judge: undefined });
                  }}
                >
                  {t('lobeBench.settings.judge.clear')}
                </Button>
              )}
              {!builtIn && (
                <Button
                  disabled={!judge}
                  loading={saving === 'judge'}
                  type={'primary'}
                  onClick={() => save('judge', { judge })}
                >
                  {t('lobeBench.settings.save')}
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        </Block>

        <Block padding={16} variant={'outlined'}>
          <Flexbox gap={12}>
            <Flexbox gap={2}>
              <Text weight={600}>{t('lobeBench.settings.mock')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.settings.mock.hint')}
              </Text>
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('lobeBench.settings.mock.dataset')}
              </Text>
              <Input
                disabled={builtIn}
                placeholder={'all293'}
                value={mockDataset}
                variant={'filled'}
                onChange={(e) => setMockDataset(e.target.value)}
              />
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
              <Flexbox gap={4}>
                <span className={stylex.props(styles.status).className} style={{ color: mockTone }}>
                  {mockLine}
                </span>
                {mockStatus?.configured &&
                  Object.entries(mockStatus.upstreams ?? {}).map(([dataset, upstream]) => (
                    <span
                      className={stylex.props(styles.status).className}
                      key={dataset}
                      style={{
                        color: upstream.ok ? cssVar.colorSuccessText : cssVar.colorWarningText,
                      }}
                    >
                      {upstream.ok
                        ? t('lobeBench.settings.mock.status.upstreamOk', {
                            cases: upstream.cases ?? '?',
                            dataset,
                            release: upstream.release ?? '',
                          })
                        : t('lobeBench.settings.mock.status.upstreamDown', {
                            dataset,
                            error: upstream.error ?? '',
                          })}
                    </span>
                  ))}
              </Flexbox>
              <Flexbox horizontal gap={8}>
                <Button loading={checking} onClick={() => recheck()}>
                  {t('lobeBench.benchmark.mock.retry')}
                </Button>
                {!builtIn && (
                  <Button
                    loading={saving === 'mock'}
                    type={'primary'}
                    onClick={() =>
                      save('mock', {
                        mock: { ...meta.mock, dataset: mockDataset.trim() || undefined },
                      })
                    }
                  >
                    {t('lobeBench.settings.save')}
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Block>

        <Block padding={16} variant={'outlined'}>
          <Flexbox gap={12}>
            <Flexbox gap={2}>
              <Text weight={600}>{t('lobeBench.settings.defaults')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('lobeBench.settings.defaults.hint')}
              </Text>
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('lobeBench.settings.defaults.k')}
              </Text>
              <Segmented
                disabled={builtIn}
                value={String(k)}
                options={K_OPTIONS.map((option) => ({
                  label: `${option}×`,
                  value: String(option),
                }))}
                onChange={(value) => setK(Number(value))}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('lobeBench.settings.defaults.maxSteps')}
              </Text>
              <InputNumber
                disabled={builtIn}
                max={1000}
                min={1}
                style={{ width: '100%' }}
                value={maxSteps}
                variant={'filled'}
                onChange={(value) => setMaxSteps(value as number | null)}
              />
            </Flexbox>
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('lobeBench.settings.defaults.timeout')}
              </Text>
              <InputNumber
                disabled={builtIn}
                max={240}
                min={1}
                style={{ width: '100%' }}
                value={timeoutMinutes}
                variant={'filled'}
                onChange={(value) => setTimeoutMinutes(value as number | null)}
              />
            </Flexbox>
            <Flexbox horizontal justify={'flex-end'}>
              {!builtIn && (
                <Button
                  loading={saving === 'defaults'}
                  type={'primary'}
                  onClick={() =>
                    save('defaults', {
                      defaults: {
                        k,
                        maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
                        timeoutMinutes: timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
                      },
                    })
                  }
                >
                  {t('lobeBench.settings.save')}
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        </Block>
      </Flexbox>
    </Flexbox>
  );
});

LobeBenchSettings.displayName = 'LobeBenchSettings';

export default LobeBenchSettings;
