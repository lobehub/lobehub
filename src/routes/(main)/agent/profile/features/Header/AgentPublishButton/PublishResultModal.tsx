'use client';

import { FluentEmoji, Modal, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface PublishResultModalProps {
  identifier?: string;
  onCancel: () => void;
  open: boolean;
}

const PublishResultModal = memo<PublishResultModalProps>(({ identifier, onCancel, open }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');

  const handleGoToMarket = () => {
    if (identifier) {
      navigate(`/community/agent/${identifier}`);
    }
    onCancel();
  };

  return (
    <Modal
      centered
      cancelText={tCommon('cancel')}
      okText={t('marketPublish.resultModal.view')}
      open={open}
      title={null}
      width={440}
      onCancel={onCancel}
      onOk={handleGoToMarket}
    >
      <Result
        icon={<FluentEmoji emoji={'🎉'} size={96} type={'anim'} />}
        style={{
          paddingBottom: 32,
          paddingTop: 48,
          width: '100%',
        }}
        subTitle={
          <Text fontSize={14} type={'secondary'}>
            {t('marketPublish.resultModal.message')}
          </Text>
        }
        title={
          <Text fontSize={28} weight={'bold'}>
            {t('marketPublish.resultModal.title')}
          </Text>
        }
      />
    </Modal>
  );
});

export default PublishResultModal;
