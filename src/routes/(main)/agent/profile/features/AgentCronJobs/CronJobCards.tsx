'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { Badge, Card, Col, Popconfirm, Row, Switch, Typography } from 'antd';
import dayjs from 'dayjs';
import { Calendar, Clock, Edit, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentCronJob } from '@/database/schemas/agentCronJob';

import { useAgentCronJobs } from './hooks/useAgentCronJobs';

const { Text } = Typography;

interface CronJobCardsProps {
  cronJobs: AgentCronJob[];
  loading?: boolean;
  onDelete: (jobId: string) => void;
  onEdit: (jobId: string) => void;
}

const getIntervalText = (cronPattern: string) => {
  const intervalMap: Record<string, string> = {
    '*/30 * * * *': 'agentCronJobs.interval.30min',
    '0 * * * *': 'agentCronJobs.interval.1hour',
    '0 */12 * * *': 'agentCronJobs.interval.12hours',
    '0 */2 * * *': 'agentCronJobs.interval.2hours',
    '0 */6 * * *': 'agentCronJobs.interval.6hours',
    '0 0 * * *': 'agentCronJobs.interval.daily',
    '0 0 * * 0': 'agentCronJobs.interval.weekly',
  };

  return intervalMap[cronPattern] || cronPattern;
};

const getStatusInfo = (job: AgentCronJob) => {
  if (!job.enabled) {
    return { status: 'default' as const, text: 'agentCronJobs.status.disabled' };
  }

  if (job.remainingExecutions === 0) {
    return { status: 'error' as const, text: 'agentCronJobs.status.depleted' };
  }

  return { status: 'success' as const, text: 'agentCronJobs.status.enabled' };
};

const CronJobCards = memo<CronJobCardsProps>(({ cronJobs, loading, onDelete, onEdit }) => {
  const { t } = useTranslation('setting');
  const { updateCronJob } = useAgentCronJobs();

  const handleToggleEnabled = async (job: AgentCronJob) => {
    await updateCronJob(job.id, { enabled: !job.enabled });
  };

  return (
    <Row gutter={[12, 12]}>
      {cronJobs.map((job) => {
        const statusInfo = getStatusInfo(job);
        const intervalText = getIntervalText(job.cronPattern);

        return (
          <Col key={job.id} lg={8} md={12} xs={24}>
            <Card
              loading={loading}
              size="small"
              style={{ height: '100%' }}
              extra={
                <Flexbox horizontal align="center" gap={4}>
                  <ActionIcon
                    icon={Edit}
                    size="small"
                    title={t('agentCronJobs.editJob')}
                    onClick={() => onEdit(job.id)}
                  />
                  <Popconfirm
                    title={t('agentCronJobs.confirmDelete')}
                    onConfirm={() => onDelete(job.id)}
                  >
                    <ActionIcon icon={Trash2} size="small" title={t('agentCronJobs.deleteJob')} />
                  </Popconfirm>
                </Flexbox>
              }
              styles={{
                actions: { marginTop: 0 },
                body: { paddingBottom: 12, paddingTop: 8 },
                header: { borderBottom: 'none', marginTop: '8px', minHeight: 0, paddingBottom: 0 },
              }}
              title={
                <Flexbox horizontal align="center" justify="space-between">
                  <Flexbox horizontal align="center" gap={8} style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {job.name || t('agentCronJobs.unnamedTask')}
                    </span>
                    <Badge status={statusInfo.status} />
                  </Flexbox>
                  <Switch
                    checked={job.enabled || false}
                    size="small"
                    onChange={() => handleToggleEnabled(job)}
                  />
                </Flexbox>
              }
            >
              <Flexbox gap={8}>
                <Text
                  ellipsis={{ tooltip: job.content }}
                  style={{
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    color: '#666',
                    display: '-webkit-box',
                    fontSize: '12px',
                    overflow: 'hidden',
                  }}
                >
                  {job.content}
                </Text>

                <Flexbox gap={8}>
                  <Flexbox horizontal align="center" gap={6}>
                    <Icon icon={Clock} size={12} />
                    <Text style={{ fontSize: '11px' }}>{t(intervalText as any)}</Text>
                  </Flexbox>

                  {job.remainingExecutions !== null && (
                    <Flexbox horizontal align="center" gap={6}>
                      <Text style={{ fontSize: '11px' }}>
                        {t('agentCronJobs.remainingExecutions', { count: job.remainingExecutions })}
                      </Text>
                    </Flexbox>
                  )}

                  {job.lastExecutedAt && (
                    <Flexbox horizontal align="center" gap={6}>
                      <Icon icon={Calendar} size={12} />
                      <Text style={{ fontSize: '11px' }}>
                        {dayjs(job.lastExecutedAt).format('MM/DD HH:mm')}
                      </Text>
                    </Flexbox>
                  )}
                </Flexbox>
              </Flexbox>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
});

export default CronJobCards;
