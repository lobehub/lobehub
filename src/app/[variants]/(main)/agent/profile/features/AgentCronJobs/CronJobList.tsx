'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { Badge, List, Popconfirm, Switch, Typography } from 'antd';
import dayjs from 'dayjs';
import { Calendar, Clock, Edit, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentCronJob } from '@/database/schemas/agentCronJob';

import { useAgentCronJobs } from './hooks/useAgentCronJobs';

const { Text, Paragraph } = Typography;

interface CronJobListProps {
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

const CronJobList = memo<CronJobListProps>(({ cronJobs, loading, onEdit, onDelete }) => {
  const { t } = useTranslation('setting');
  const { updateCronJob } = useAgentCronJobs();

  const handleToggleEnabled = async (job: AgentCronJob) => {
    await updateCronJob(job.id, { enabled: !job.enabled });
  };

  return (
    <List
      dataSource={cronJobs}
      loading={loading}
      renderItem={(job) => {
        const statusInfo = getStatusInfo(job);
        const intervalText = getIntervalText(job.cronPattern);

        return (
          <List.Item
            actions={[
              <ActionIcon
                icon={Edit}
                key="edit"
                size="small"
                title={t('agentCronJobs.editJob')}
                onClick={() => onEdit(job.id)}
              />,
              <Popconfirm
                key="delete"
                title={t('agentCronJobs.confirmDelete')}
                onConfirm={() => onDelete(job.id)}
              >
                <ActionIcon icon={Trash2} size="small" title={t('agentCronJobs.deleteJob')} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <Switch
                  checked={job.enabled || false}
                  size="small"
                  onChange={() => handleToggleEnabled(job)}
                />
              }
              description={
                <Flexbox gap={4}>
                  <Paragraph
                    ellipsis={{ rows: 2, tooltip: job.content }}
                    style={{ color: '#666', fontSize: '12px', margin: 0 }}
                  >
                    {job.content}
                  </Paragraph>

                  <Flexbox horizontal gap={8} style={{ marginTop: 4 }}>
                    <Flexbox horizontal align="center" gap={4}>
                      <Icon icon={Clock} size={12} />
                      <Text style={{ fontSize: '11px' }}>{t(intervalText as any)}</Text>
                    </Flexbox>

                    {job.remainingExecutions !== null && (
                      <Text style={{ fontSize: '11px' }}>
                        {t('agentCronJobs.remainingExecutions', { count: job.remainingExecutions })}
                      </Text>
                    )}

                    {job.lastExecutedAt && (
                      <Flexbox horizontal align="center" gap={4}>
                        <Icon icon={Calendar} size={12} />
                        <Text style={{ fontSize: '11px' }}>
                          {dayjs(job.lastExecutedAt).format('MM/DD HH:mm')}
                        </Text>
                      </Flexbox>
                    )}
                  </Flexbox>
                </Flexbox>
              }
              title={
                <Flexbox horizontal align="center" gap={8}>
                  <span>{job.name}</span>
                  <Badge status={statusInfo.status} text={t(statusInfo.text as any)} />
                </Flexbox>
              }
            />
          </List.Item>
        );
      }}
    />
  );
});

export default CronJobList;
