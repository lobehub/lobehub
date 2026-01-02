'use client';

import { ExclamationCircleOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { FluentEmoji, Text , Button } from '@lobehub/ui';
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
    navigate('/community/assistant');
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
          extra={
            <Button onClick={handleBackToMarket} size={'large'} type="primary">
              {t('assistants.status.backToMarket')}
            </Button>
          }
          icon={<FluentEmoji emoji={'⌛'} size={96} type={'anim'} />}
          subTitle={
            <Text fontSize={16} type={'secondary'}>
              <Trans
                components={{
                  email: <a href="mailto:support@lobehub.com">support@lobehub.com</a>,
                }}
                i18nKey="assistants.status.unpublished.subtitle"
                ns="discover"
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
        extra={
          <Button onClick={handleBackToMarket} type="primary">
            {t('assistants.status.backToMarket')}
          </Button>
        }
        icon={statusIcon}
        subTitle={
          <div style={{ color: '#666', lineHeight: 1.6 }}>
            <p>{t(`assistants.status.${statusKey}.subtitle`)}</p>
            <ul style={{ margin: '16px 0', paddingLeft: '20px', textAlign: 'left' }}>
              <li>{t(`assistants.status.${statusKey}.reasons.owner`)}</li>
              <li>{t(`assistants.status.${statusKey}.reasons.official`)}</li>
            </ul>
            <p>
              <Trans
                components={{
                  email: <a href="mailto:support@lobehub.com">support@lobehub.com</a>,
                }}
                i18nKey="assistants.status.support"
                ns="discover"
              />
            </p>
          </div>
        }
        title={t(`assistants.status.${statusKey}.title`)}
      />
    </div>
  );
});

export default StatusPage;
