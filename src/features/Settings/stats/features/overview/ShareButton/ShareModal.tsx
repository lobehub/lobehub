'use client';

import { Button, Modal, Skeleton, Tabs } from '@lobehub/ui';
import { Form, type FormFieldProps, useForm, useWatch } from '@lobehub/ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ImageType, imageTypeOptions, useScreenshot } from '@/hooks/useScreenshot';
import dynamic from '@/libs/next/dynamic';

const Preview = dynamic(() => import('./Preview'), {
  loading: () => <Skeleton height={400} width={'100%'} />,
});

type FieldType = {
  imageType: ImageType;
};

const DEFAULT_FIELD_VALUE: FieldType = {
  imageType: ImageType.JPG,
};

interface ShareModalProps {
  mobile?: boolean;
  onCancel?: () => void;
  open?: boolean;
}

const ShareModal = memo<ShareModalProps>(({ open, onCancel, mobile }) => {
  const { t } = useTranslation(['chat', 'common']);
  const form = useForm<FieldType>({ initialValues: DEFAULT_FIELD_VALUE });
  const imageType = useWatch(form, 'imageType');
  const { loading, onDownload } = useScreenshot({
    imageType,
    title: 'stats',
    width: mobile ? 440 : undefined,
  });

  const items: FormFieldProps<FieldType>[] = [
    {
      bare: true,
      children: <Preview />,
    },
    {
      children: <Tabs items={imageTypeOptions} />,
      divider: false,
      label: t('shareModal.imageType'),
      name: 'imageType',
      valueProp: 'activeKey',
    },
  ];

  return (
    <Modal
      allowFullscreen
      open={open}
      title={t('share', { ns: 'common' })}
      width={480}
      footer={
        <Button block loading={loading} type={'primary'} onClick={onDownload}>
          {t('shareModal.download')}
        </Button>
      }
      onCancel={onCancel}
    >
      <Form form={form} gap={24} items={items} itemsType={'flat'} />
    </Modal>
  );
});

export default ShareModal;
