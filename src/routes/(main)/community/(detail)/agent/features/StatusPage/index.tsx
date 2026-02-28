'use client';

import { ExclamationCircleOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button, FluentEmoji, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface StatusPageProps {
  status: 'unpublished' | 'archived' | 'deprecated';
}

const StatusPage = memo<StatusPageProps>(({ status }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('discover');

  const handleBackToMarket = () => {
    navigate('/community/agent');
  };

  // 审核中状态
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
              {t('assistants.status.backToMarket')}
            </Button>
          }
          subTitle={
            <Text fontSize={16} type={'secondary'}>
              <Trans
                i18nKey="assistants.status.unpublished.subtitle"
                ns="discover"
                components={{
                  email: <a href="mailto:support@lobehub.com">support@lobehub.com</a>,
                }}
              />
            </Text>
          }
          title={
            <Text fontSize={28} weight={'bold'}>
              {t('assistants.status.unpublished.title')}
            </Text>
          }
        />
      </div>
    );
  }

  // 归档/拒绝状态
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
        title={t(`assistants.status.${statusKey}.title`)}
        extra={
          <Button type="primary" onClick={handleBackToMarket}>
            {t('assistants.status.backToMarket')}
          </Button>
        }
        subTitle={
          <div style={{ color: '#666', lineHeight: 1.6 }}>
            <p>{t(`assistants.status.${statusKey}.subtitle`)}</p>
            <ul style={{ margin: '16px 0', paddingLeft: '20px', textAlign: 'left' }}>
              <li>{t(`assistants.status.${statusKey}.reasons.owner`)}</li>
              <li>{t(`assistants.status.${statusKey}.reasons.official`)}</li>
            </ul>
            <p>
              <Trans
                i18nKey="assistants.status.support"
                ns="discover"
                components={{
                  email: <a href="mailto:support@lobehub.com">support@lobehub.com</a>,
                }}
              />
            </p>
          </div>
        }
      />
    </div>
  );
});

export default StatusPage;
