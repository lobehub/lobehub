'use client';

import { BarChart } from '@lobehub/charts';
import { Flexbox, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ScatterPlot from './ScatterPlot';
import StatusDonut from './StatusDonut';

const styles = stylex.create({
  chartCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  chartTitle: {
    marginBlockEnd: '12px',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  legendDot: { width: '8px', height: '8px', borderRadius: '999px' },
  legendText: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
  totalCount: {
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusXS,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

interface BenchmarkChartsProps {
  benchmarkId: string;
  results: any[];
  runId: string;
}

const BenchmarkCharts = memo<BenchmarkChartsProps>(({ results, benchmarkId, runId }) => {
  const { t } = useTranslation('eval');
  const theme = useTheme();

  const { errorCases, failedCases, histogramData, passedCases } = useMemo(() => {
    if (!results || results.length === 0)
      return { errorCases: 0, failedCases: 0, histogramData: [], passedCases: 0 };

    let passed = 0;
    let failed = 0;
    let errors = 0;

    const durations: { duration: number; status?: string }[] = [];

    for (const r of results) {
      const duration = (r.evalResult?.duration || 0) / 1000;
      const status: string | undefined = r.status;

      if (status === 'passed') passed++;
      else if (status === 'error') errors++;
      else if (status === 'failed') failed++;

      durations.push({ duration, status });
    }

    // Fixed buckets: <1min, 1~3min, 3~5min, >5min
    const buckets = [
      { error: 0, failed: 0, max: 60, passed: 0, range: '<1min' },
      { error: 0, failed: 0, max: 180, passed: 0, range: '1~3min' },
      { error: 0, failed: 0, max: 300, passed: 0, range: '3~5min' },
      { error: 0, failed: 0, max: Infinity, passed: 0, range: '>5min' },
    ];

    for (const d of durations) {
      const idx = d.duration < 60 ? 0 : d.duration < 180 ? 1 : d.duration < 300 ? 2 : 3;
      if (d.status === 'passed') buckets[idx].passed++;
      else if (d.status === 'error') buckets[idx].error++;
      else buckets[idx].failed++;
    }

    return {
      errorCases: errors,
      failedCases: failed,
      histogramData: buckets,
      passedCases: passed,
    };
  }, [results]);

  const passLabel = t('run.chart.pass');
  const failLabel = t('run.chart.fail');
  const errorLabel = t('run.chart.error');
  const histogramChartData = useMemo(
    () =>
      histogramData.map((b) => ({
        [errorLabel]: b.error,
        [failLabel]: b.failed,
        [passLabel]: b.passed,
        range: b.range,
      })),
    [histogramData, passLabel, failLabel, errorLabel],
  );

  if (!results || results.length === 0) return null;

  return (
    <Flexbox horizontal gap={16} style={{ height: 320 }}>
      {/* Chart 1: Status Donut */}
      <Flexbox className={stylex.props(styles.chartCard).className} flex={1}>
        <div {...stylex.props(styles.chartTitle)}>{t('run.chart.passFailError')}</div>
        <Flexbox align="center" flex={1} justify="center">
          <StatusDonut
            errorCases={errorCases}
            failedCases={failedCases}
            passedCases={passedCases}
          />
        </Flexbox>
      </Flexbox>

      {/* Chart 2: Scatter Plot */}
      <Flexbox className={stylex.props(styles.chartCard).className} flex={2}>
        <Flexbox horizontal justify={'space-between'} style={{ marginBlockEnd: 12 }}>
          <span className={stylex.props(styles.chartTitle).className} style={{ marginBlockEnd: 0 }}>
            {t('run.chart.latencyTokenDistribution')}
          </span>
          <Flexbox horizontal gap={12} style={{ fontSize: cssVar.fontSizeSM }}>
            <Flexbox horizontal align={'center'} gap={4}>
              <div
                className={stylex.props(styles.legendDot).className}
                style={{ background: theme.colorSuccess }}
              />
              <span {...stylex.props(styles.legendText)}>{t('run.chart.pass')}</span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={4}>
              <div
                className={stylex.props(styles.legendDot).className}
                style={{ background: theme.colorFill }}
              />
              <span {...stylex.props(styles.legendText)}>{t('run.chart.fail')}</span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={4}>
              <div
                className={stylex.props(styles.legendDot).className}
                style={{ background: theme.colorWarning }}
              />
              <span {...stylex.props(styles.legendText)}>{t('run.chart.error')}</span>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <ScatterPlot benchmarkId={benchmarkId} results={results} runId={runId} />
      </Flexbox>

      {/* Chart 3: Histogram */}
      <Flexbox className={stylex.props(styles.chartCard).className} flex={1}>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.chartTitle).className}
          gap={8}
        >
          <span>{t('run.chart.latencyDistribution')}</span>
          <span {...stylex.props(styles.totalCount)}>{results.length}</span>
        </Flexbox>
        <BarChart
          stack
          categories={[passLabel, failLabel, errorLabel]}
          colors={[theme.colorSuccess, theme.colorFill, theme.colorWarning]}
          data={histogramChartData}
          index="range"
          showLegend={false}
          showYAxis={false}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default BenchmarkCharts;
