// Fixture: a titled section card turns its whole body into a multi-field form
// with Cancel / Save. The card has room for the form, so in-place is accepted.
import { Flexbox } from '@lobehub/ui';
import { Button, Input, Text, TextArea } from '@lobehub/ui/base-ui';
import { Form, useForm } from '@lobehub/ui/base-ui/form';
import { PencilIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SectionCard from './SectionCard';

interface AppInfo {
  description?: string;
  name: string;
}

interface BasicInfoCardProps {
  app: AppInfo;
  onSubmit: (value: AppInfo) => Promise<void>;
}

const BasicInfoCard: FC<BasicInfoCardProps> = ({ app, onSubmit }) => {
  const { t } = useTranslation('app');
  const [editing, setEditing] = useState(false);
  const form = useForm<AppInfo>({
    onSubmit: async (values) => {
      await onSubmit(values);
      setEditing(false);
    },
  });

  const startEditing = () => {
    form.reset({ description: app.description ?? '', name: app.name });
    setEditing(true);
  };

  return (
    <SectionCard
      title={t('basicInfo')}
      extra={
        !editing && (
          <Button icon={<PencilIcon size={14} />} size={'small'} onClick={startEditing}>
            {t('edit')}
          </Button>
        )
      }
    >
      {editing ? (
        <Form form={form} layout={'vertical'}>
          <Flexbox gap={16}>
            <Form.Field label={t('name')} name={'name'}>
              <Input variant={'filled'} />
            </Form.Field>
            <Form.Field label={t('description')} name={'description'}>
              <TextArea rows={2} variant={'filled'} />
            </Form.Field>
            <Flexbox horizontal gap={8} justify={'flex-end'}>
              <Button onClick={() => setEditing(false)}>{t('cancel')}</Button>
              <Button htmlType={'submit'} type={'primary'}>
                {t('save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Form>
      ) : (
        <Flexbox gap={4}>
          <Text strong>{app.name}</Text>
          <Text type={'secondary'}>{app.description}</Text>
        </Flexbox>
      )}
    </SectionCard>
  );
};

export default BasicInfoCard;
