'use client';

import { AGENT_PROFILE_URL } from '@lobechat/const';
import { Avatar, Button, Flexbox } from '@lobehub/ui';
import { Descriptions, Tag, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface RunInfoProps {
  benchmarkId: string;
  run: {
    config?: {
      agentSnapshot?: {
        avatar?: string | null;
        model?: string | null;
        provider?: string | null;
        title?: string | null;
      };
      concurrency?: number;
      timeout?: number;
    };
    dataset?: {
      description?: string | null;
      id: string;
      name: string;
    };
    targetAgent?: {
      avatar?: string | null;
      id: string;
      model?: string;
      provider?: string;
      title?: string | null;
    };
    targetAgentId?: string | null;
  };
}

const RunInfo = memo<RunInfoProps>(({ benchmarkId, run }) => {
  const { t } = useTranslation('eval');

  const snapshot = run.config?.agentSnapshot;
  const agentTitle = run.targetAgent?.title || t('run.detail.agent.unnamed');
  const agentAvatar = snapshot?.avatar || run.targetAgent?.avatar;
  const agentModel = snapshot?.model || run.targetAgent?.model;
  const agentProvider = snapshot?.provider || run.targetAgent?.provider;

  const handleOpenAgent = () => {
    if (run.targetAgentId) {
      window.open(AGENT_PROFILE_URL(run.targetAgentId), '_blank');
    }
  };

  return (
    <Descriptions
      column={{ lg: 3, md: 2, sm: 1 }}
      size="small"
      items={[
        {
          children: run.dataset ? (
            <Link target="_blank" to={`/eval/bench/${benchmarkId}/datasets/${run.dataset.id}`}>
              <Tag style={{ cursor: 'pointer' }}>{run.dataset.name}</Tag>
            </Link>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
          key: 'dataset',
          label: t('run.detail.dataset'),
        },
        {
          children: run.targetAgentId ? (
            <Flexbox horizontal align="center" gap={8}>
              <Avatar avatar={agentAvatar} size={20} />
              <Button
                size="small"
                style={{ height: 'auto', padding: 0 }}
                variant="text"
                onClick={handleOpenAgent}
              >
                {agentTitle}
              </Button>
            </Flexbox>
          ) : (
            <Typography.Text type="secondary">{t('run.detail.agent.none')}</Typography.Text>
          ),
          key: 'agent',
          label: t('run.detail.agent'),
        },
        {
          children: agentModel ? (
            <Tag>
              {agentProvider ? `${agentProvider} / ` : ''}
              {agentModel}
            </Tag>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
          key: 'model',
          label: t('run.detail.model'),
        },
      ]}
    />
  );
});

export default RunInfo;
