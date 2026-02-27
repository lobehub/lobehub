'use client';

import { Flexbox } from '@lobehub/ui';
import { Card, Progress, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import StatusBadge from '@/app/[variants]/(main)/eval/features/StatusBadge';

interface RunSummaryCardProps {
  benchmarkId: string;
  id: string;
  metrics?: {
    averageScore?: number;
    passRate?: number;
    totalCases?: number;
  };
  name?: string;
  status: string;
}

const RunSummaryCard = memo<RunSummaryCardProps>(
  ({ id, name, status, metrics, benchmarkId }) => {
    const { t } = useTranslation('eval');
    const isActive = status === 'running' || status === 'pending';

    return (
      <Link
        style={{ color: 'inherit', textDecoration: 'none' }}
        to={`/eval/bench/${benchmarkId}/runs/${id}`}
      >
        <Card hoverable size="small">
          <Flexbox gap={8}>
            <Flexbox align="center" horizontal justify="space-between">
              <Typography.Text strong>{name || id.slice(0, 8)}</Typography.Text>
              <StatusBadge status={status} />
            </Flexbox>
            {!isActive && metrics && (
              <Flexbox gap={4}>
                {metrics.passRate !== undefined && (
                  <Flexbox align="center" gap={8} horizontal>
                    <Typography.Text style={{ fontSize: 12 }} type="secondary">
                      {t('run.metrics.passRate')}
                    </Typography.Text>
                    <Progress
                      percent={Math.round(metrics.passRate * 100)}
                      size="small"
                      style={{ flex: 1 }}
                    />
                  </Flexbox>
                )}
                {metrics.averageScore !== undefined && (
                  <Typography.Text style={{ fontSize: 12 }} type="secondary">
                    {t('run.metrics.avgScore')}: {metrics.averageScore.toFixed(2)}
                  </Typography.Text>
                )}
              </Flexbox>
            )}
          </Flexbox>
        </Card>
      </Link>
    );
  },
);

export default RunSummaryCard;
