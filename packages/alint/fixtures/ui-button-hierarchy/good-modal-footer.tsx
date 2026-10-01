// Fixture: one primary commit action, a filled secondary, a text utility.
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface CreateFooterProps {
  loading: boolean;
  onCancel: () => void;
  onCreate: () => void;
  onPreview: () => void;
}

const CreateFooter = memo<CreateFooterProps>(({ loading, onCancel, onCreate, onPreview }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal gap={8} justify={'flex-end'}>
      <Button type={'text'} onClick={onPreview}>
        {t('preview')}
      </Button>
      <Button type={'fill'} onClick={onCancel}>
        {t('cancel')}
      </Button>
      <Button loading={loading} type={'primary'} onClick={onCreate}>
        {t('create')}
      </Button>
    </Flexbox>
  );
});

export default CreateFooter;
