import { ActionIcon, Button, Modal , Skeleton } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { Brush } from 'lucide-react';
import dynamic from '@/libs/next/dynamic';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

const Inner = dynamic(() => import('./Inner'), {
  loading: () => <Skeleton paragraph={{ rows: 8 }} title={false} />,
});

const CreateButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { mobile: resMobile } = useResponsive();
  const { t } = useTranslation('discover');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const buttonContent =
    mobile || resMobile ? (
      <ActionIcon
        icon={Brush}
        onClick={() => setIsModalOpen(true)}
        size={MOBILE_HEADER_ICON_SIZE}
        title={t('create')}
      />
    ) : (
      <Button icon={Brush} onClick={() => setIsModalOpen(true)}>
        {t('create')}
      </Button>
    );

  return (
    <>
      {buttonContent}
      <Modal
        allowFullscreen
        footer={null}
        onCancel={() => setIsModalOpen(false)}
        open={isModalOpen}
        title={t('create')}
      >
        <Inner />
      </Modal>
    </>
  );
});

export default CreateButton;
