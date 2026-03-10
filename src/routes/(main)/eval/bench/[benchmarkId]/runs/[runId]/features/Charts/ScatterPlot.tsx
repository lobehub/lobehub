'use client';

import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Tag } from '@lobehub/ui';
import { Divider, Tooltip } from 'antd';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  axisLabel: css`
    pointer-events: none;
    position: absolute;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  dot: css`
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      transform: translate(-50%, 50%) scale(1.5);
      opacity: 1 !important;
    }
  `,
  scatterArea: css`
    position: relative;
    overflow: hidden;
    flex: 1;
  `,
  tooltipLabel: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface ScatterPlotProps {
  benchmarkId: string;
  results: any[];
  runId: string;
}

const ScatterPlot = memo<ScatterPlotProps>(({ results, benchmarkId, runId }) => {
  const { t } = useTranslation('eval');
  const theme = useTheme();

  const { maxDuration, maxTokens, scatterData } = useMemo(() => {
    if (!results || results.length === 0) return { maxDuration: 0, maxTokens: 0, scatterData: [] };

    let maxDur = 0;
    let maxTok = 0;

    const data = results.map((r: any) => {
      const duration = (r.evalResult?.duration || 0) / 1000;
      const tokens = r.evalResult?.tokens || 0;
      const cost: number | undefined = r.evalResult?.cost;
      const status: string | undefined = r.status;
      const input: string = r.testCase?.content?.input || '';
      const expected: string = r.testCase?.content?.expected || '';
      const sortOrder: number | undefined = r.testCase?.sortOrder;
      const testCaseId: string = r.testCaseId || '';

      if (duration > maxDur) maxDur = duration;
      if (tokens > maxTok) maxTok = tokens;

      return { cost, duration, expected, input, sortOrder, status, testCaseId, tokens };
    });

    return { maxDuration: maxDur, maxTokens: maxTok, scatterData: data };
  }, [results]);

  if (!results || results.length === 0) return null;

  return (
    <div className={styles.scatterArea}>
      {/* Grid lines via SVG */}
      <svg
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        style={{
          height: '100%',
          insetBlockStart: 0,
          insetInlineStart: 0,
          position: 'absolute',
          width: '100%',
        }}
      >
        <line stroke={theme.colorBorder} strokeWidth="0.5" x1="0" x2="100" y1="100" y2="100" />
        <line stroke={theme.colorBorder} strokeWidth="0.5" x1="0" x2="0" y1="0" y2="100" />
        {[1, 2, 3].map((i) => (
          <line
            key={i}
            stroke={theme.colorBorder}
            strokeDasharray="2 2"
            strokeOpacity="0.5"
            strokeWidth="0.5"
            x1="0"
            x2="100"
            y1={100 - i * 25}
            y2={100 - i * 25}
          />
        ))}
      </svg>
      {/* Data dots */}
      {scatterData.map((d, i) => {
        const xPct = (d.tokens / (maxTokens || 1)) * 92 + 4;
        const yPct = (d.duration / (maxDuration || 1)) * 88 + 6;
        const fill =
          d.status === 'passed'
            ? theme.colorSuccess
            : d.status === 'error'
              ? theme.colorWarning
              : theme.colorError;
        const tagColor = d.status === 'passed' ? 'green' : d.status === 'error' ? 'orange' : 'red';
        const statusLabel =
          d.status === 'passed'
            ? t('run.chart.pass')
            : d.status === 'error'
              ? t('run.chart.error')
              : t('run.chart.fail');
        const inputPreview = d.input.length > 60 ? d.input.slice(0, 60) + '...' : d.input;
        const expectedPreview =
          d.expected.length > 60 ? d.expected.slice(0, 60) + '...' : d.expected;
        const caseUrl = `/eval/bench/${benchmarkId}/runs/${runId}/cases/${d.testCaseId}`;
        return (
          <Tooltip
            key={i}
            title={
              <Flexbox gap={4} style={{ fontSize: 12, maxWidth: 320 }}>
                {/* Row 1: #Number [Tag] ... Duration */}
                <Flexbox horizontal align="center" gap={6} justify="space-between">
                  <Flexbox horizontal align="center" gap={6}>
                    <span style={{ fontWeight: 600 }}>#{d.sortOrder ?? i + 1}</span>
                    <Tag color={tagColor} size="small">
                      {statusLabel}
                    </Tag>
                  </Flexbox>
                  <span className={styles.tooltipLabel}>{d.duration.toFixed(2)}s</span>
                </Flexbox>
                {/* Row 2: Input */}
                {inputPreview && (
                  <div style={{ lineHeight: 1.4, wordBreak: 'break-all' }}>{inputPreview}</div>
                )}
                {/* Row 3: Expected */}
                {expectedPreview && (
                  <div
                    className={styles.tooltipLabel}
                    style={{ lineHeight: 1.4, wordBreak: 'break-all' }}
                  >
                    {expectedPreview}
                  </div>
                )}
                {/* Divider */}
                <Divider style={{ margin: '2px 0' }} />
                {/* Tokens & Cost */}
                <Flexbox horizontal gap={16}>
                  <div>
                    <span className={styles.tooltipLabel}>{t('run.chart.tokens')}: </span>
                    {formatShortenNumber(d.tokens)}
                  </div>
                  {d.cost !== undefined && (
                    <div>
                      <span className={styles.tooltipLabel}>{t('run.metrics.cost')}: </span>$
                      {formatCost(d.cost)}
                    </div>
                  )}
                </Flexbox>
              </Flexbox>
            }
          >
            <div
              className={styles.dot}
              style={{
                background: fill,
                borderRadius: '50%',
                bottom: `${yPct}%`,
                height: 7,
                left: `${xPct}%`,
                opacity: 0.8,
                position: 'absolute',
                transform: 'translate(-50%, 50%)',
                width: 7,
              }}
              onClick={() => window.open(caseUrl, '_blank')}
            />
          </Tooltip>
        );
      })}
      {/* Axis labels */}
      <span className={styles.axisLabel} style={{ bottom: 2, right: 4 }}>
        {t('run.chart.tokens')}
      </span>
      <span className={styles.axisLabel} style={{ left: 4, top: 0 }}>
        {t('run.chart.duration')}
      </span>
    </div>
  );
});

export default ScatterPlot;
