'use client';

import { BarChart } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ScatterPlot from './ScatterPlot';
import StatusDonut from './StatusDonut';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chartCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  chartTitle: css`
    margin-block-end: 12px;
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  legendDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  legendText: css`
    color: ${cssVar.colorTextSecondary};
  `,
  totalCount: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
}));

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
      <Flexbox className={styles.chartCard} flex={1}>
        <div className={styles.chartTitle}>{t('run.chart.passFailError')}</div>
        <Flexbox align="center" flex={1} justify="center">
          <StatusDonut
            errorCases={errorCases}
            failedCases={failedCases}
            passedCases={passedCases}
          />
        </Flexbox>
      </Flexbox>

      {/* Chart 2: Scatter Plot */}
      <Flexbox className={styles.chartCard} flex={2}>
        <Flexbox horizontal justify={'space-between'} style={{ marginBlockEnd: 12 }}>
          <span className={styles.chartTitle} style={{ marginBlockEnd: 0 }}>
            {t('run.chart.latencyTokenDistribution')}
          </span>
          <Flexbox horizontal gap={12} style={{ fontSize: 11 }}>
            <Flexbox horizontal align={'center'} gap={4}>
              <div className={styles.legendDot} style={{ background: theme.colorSuccess }} />
              <span className={styles.legendText}>{t('run.chart.pass')}</span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={4}>
              <div className={styles.legendDot} style={{ background: theme.colorFill }} />
              <span className={styles.legendText}>{t('run.chart.fail')}</span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={4}>
              <div className={styles.legendDot} style={{ background: theme.colorWarning }} />
              <span className={styles.legendText}>{t('run.chart.error')}</span>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <ScatterPlot benchmarkId={benchmarkId} results={results} runId={runId} />
      </Flexbox>

      {/* Chart 3: Histogram */}
      <Flexbox className={styles.chartCard} flex={1}>
        <Flexbox horizontal align="center" className={styles.chartTitle} gap={6}>
          <span>{t('run.chart.latencyDistribution')}</span>
          <span className={styles.totalCount}>{results.length}</span>
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
