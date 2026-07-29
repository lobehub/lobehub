'use client';

import { Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarUpload from '@/components/AvatarUpload';
import { type CreateOAuthAppParams } from '@/types/oauthApp';

export interface CreateAppModalContentProps {
  onSubmit: (values: CreateOAuthAppParams) => Promise<void>;
}

const CreateAppModalContent: FC<CreateAppModalContentProps> = ({ onSubmit }) => {
  const { t } = useTranslation('auth');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [form] = Form.useForm<CreateOAuthAppParams>();
  const [loading, setLoading] = useState(false);
  const [logoUri, setLogoUri] = useState<string>();

  // Once the form is dirty, a mask click must not dismiss the modal (it would
  // silently drop the user's input); the explicit ✕/ESC close still works.
  const markDirty = () => setCanDismissByClickOutside(false);

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setLogoUri(reader.result as string);
      markDirty();
    });
    reader.readAsDataURL(file);
  };

  const handleFinish = async (values: CreateOAuthAppParams) => {
    setLoading(true);
    try {
      await onSubmit({ ...values, logoUri });
      close();
    } finally {
      setLoading(false);
    }
  };

  const itemStyle = { marginBottom: 0 };

  return (
    <Form
      colon={false}
      form={form}
      layout={'vertical'}
      onFinish={handleFinish}
      onValuesChange={markDirty}
    >
      <Flexbox gap={16}>
        <Form.Item label={t('oauthApp.form.logo.label')} style={itemStyle}>
          <AvatarUpload
            title={t('oauthApp.form.name.label')}
            value={logoUri}
            onUpload={handleUpload}
          />
        </Form.Item>

        <Form.Item
          label={t('oauthApp.form.name.label')}
          name={'name'}
          rules={[{ message: t('oauthApp.validation.nameRequired'), required: true }]}
          style={itemStyle}
        >
          <Input placeholder={t('oauthApp.form.name.placeholder')} />
        </Form.Item>

        <Form.Item
          label={t('oauthApp.form.description.label')}
          name={'description'}
          style={itemStyle}
        >
          <TextArea placeholder={t('oauthApp.form.description.placeholder')} rows={3} />
        </Form.Item>

        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('oauthApp.form.submit')}
        </Button>
      </Flexbox>
    </Form>
  );
};

export default CreateAppModalContent;
