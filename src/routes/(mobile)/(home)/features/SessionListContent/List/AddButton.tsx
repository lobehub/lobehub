import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActionSWR } from '@/libs/swr';
import { sessionKeys } from '@/libs/swr/keys';
import { useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';

const AddButton = memo<{ groupId?: string }>(({ groupId }) => {
  const { t } = useTranslation('chat');
  const createSession = useSessionStore((s) => s.createSession);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { mutate, isValidating } = useActionSWR(sessionKeys.createSession(groupId), () => {
    return createSession({ group: groupId });
  });

  return (
    <Flexbox flex={1} padding={mobile ? 16 : 0}>
      <Button
        block
        icon={Plus}
        loading={isValidating}
        type={'fill'}
        style={{
          marginTop: 8,
        }}
        onClick={() => mutate()}
      >
        {t('newAgent')}
      </Button>
    </Flexbox>
  );
});

export default AddButton;
