import { Button, Flexbox, Tooltip } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCreateAgent } from '../../useCreateAgent';

const AddButton = ({
  groupId,
  visibility,
}: {
  groupId?: string;
  visibility?: 'private' | 'public';
}) => {
  const { t } = useTranslation('chat');
  const { allowed, create, loading, reason } = useCreateAgent();
  return (
    <Flexbox flex={1} padding={16}>
      <Tooltip title={reason}>
        <Button
          block
          aria-description={reason}
          disabled={!allowed || loading}
          icon={Plus}
          loading={loading}
          style={{ marginTop: 8 }}
          type={'fill'}
          onClick={() => create({ groupId, visibility })}
        >
          {t('newAgent')}
        </Button>
      </Tooltip>
    </Flexbox>
  );
};
export default AddButton;
