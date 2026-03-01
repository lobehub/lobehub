'use client';

import { ExclamationCircleOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button, FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface StatusPageProps {
  status: 'unpublished' | 'archived' | 'deprecated';
}

const StatusPage = memo<StatusPageProps>(({ status }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('discover');

  const handleBackToMarket = () => {
    navigate('/community');
  };

  // Unpublished status
  if (status === 'unpublished') {
    return (
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '20px',
        }}
      >
        <Result
          icon={<FluentEmoji emoji={'⌛'} size={96} type={'anim'} />}
          extra={
            <Button size={'large'} type="primary" onClick={handleBackToMarket}>
              {t('groupAgents.status.backToMarket', { defaultValue: 'Back to Market' })}
            </Button>
          }
          subTitle={
            <Text fontSize={16} type={'secondary'}>
              {t('groupAgents.status.unpublished.subtitle', {
                defaultValue:
                  'This group agent is under review. Please contact support@lobehub.com if you have questions.',
              })}
            </Text>
          }
          title={
            <Text fontSize={28} weight={'bold'}>
              {t('groupAgents.status.unpublished.title', { defaultValue: 'Under Review' })}
            </Text>
          }
        />
      </div>
    );
  }

  // Archived/Deprecated status
  const isArchived = status === 'archived';
  const statusKey = isArchived ? 'archived' : 'deprecated';
  const statusIcon = isArchived ? (
    <FolderOpenOutlined style={{ color: '#8c8c8c' }} />
  ) : (
    <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
  );

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flex: 1,
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '20px',
      }}
    >
      <Result
        icon={statusIcon}
        extra={
          <Button type="primary" onClick={handleBackToMarket}>
            {t('groupAgents.status.backToMarket', { defaultValue: 'Back to Market' })}
          </Button>
        }
        subTitle={
          <div style={{ color: '#666', lineHeight: 1.6 }}>
            <p>
              {t(`groupAgents.status.${statusKey}.subtitle`, {
                defaultValue: `This group agent has been ${statusKey}.`,
              })}
            </p>
          </div>
        }
        title={t(`groupAgents.status.${statusKey}.title`, {
          defaultValue: isArchived ? 'Archived' : 'Deprecated',
        })}
      />
    </div>
  );
});

export default StatusPage;
