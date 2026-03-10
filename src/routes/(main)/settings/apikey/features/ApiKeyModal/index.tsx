import { FormModal, Input } from '@lobehub/ui';
import { type Dayjs } from 'dayjs';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { type CreateApiKeyParams } from '@/types/apiKey';

import ApiKeyDatePicker from '../ApiKeyDatePicker';

interface ApiKeyModalProps {
  onCancel: () => void;
  onOk: (values: CreateApiKeyParams) => void;
  open: boolean;
  submitLoading?: boolean;
}

type FormValues = Omit<CreateApiKeyParams, 'expiresAt'> & {
  expiresAt: Dayjs | null;
};

const ApiKeyModal: FC<ApiKeyModalProps> = ({ open, onCancel, onOk, submitLoading }) => {
  const { t } = useTranslation('auth');

  return (
    <FormModal
      destroyOnHidden
      height={'90%'}
      itemMinWidth={'max(30%,240px)'}
      itemsType={'flat'}
      open={open}
      submitLoading={submitLoading}
      submitText={t('apikey.form.submit')}
      title={t('apikey.form.title')}
      items={[
        {
          children: <Input placeholder={t('apikey.form.fields.name.placeholder')} />,
          label: t('apikey.form.fields.name.label'),
          name: 'name',
          rules: [{ required: true }],
        },
        {
          children: <ApiKeyDatePicker style={{ width: '100%' }} />,
          label: t('apikey.form.fields.expiresAt.label'),
          name: 'expiresAt',
        },
      ]}
      onCancel={onCancel}
      onFinish={(values: FormValues) => {
        onOk({
          ...values,
          expiresAt: values.expiresAt ? values.expiresAt.toDate() : null,
        } satisfies CreateApiKeyParams);
      }}
    />
  );
};

export default ApiKeyModal;
