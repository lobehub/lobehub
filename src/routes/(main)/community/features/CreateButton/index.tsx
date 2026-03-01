import { ActionIcon, Button, Modal , Skeleton } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { Brush } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import dynamic from '@/libs/next/dynamic';

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
        size={MOBILE_HEADER_ICON_SIZE}
        title={t('create')}
        onClick={() => setIsModalOpen(true)}
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
        open={isModalOpen}
        title={t('create')}
        onCancel={() => setIsModalOpen(false)}
      >
        <Inner />
      </Modal>
    </>
  );
});

export default CreateButton;
