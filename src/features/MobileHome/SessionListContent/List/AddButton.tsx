import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useServerConfigStore } from '@/store/serverConfig';

const AddButton = memo<{ groupId?: string }>(({ groupId }) => {
  const { t } = useTranslation('chat');
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [loading, setLoading] = useState(false);

  return (
    <Flexbox flex={1} padding={mobile ? 16 : 0}>
      <Button
        block
        icon={Plus}
        loading={loading}
        type={'fill'}
        style={{
          marginTop: 8,
        }}
        onClick={async () => {
          setLoading(true);
          try {
            await createAgent({ groupId });
            await refreshAgentList();
          } finally {
            setLoading(false);
          }
        }}
      >
        {t('newAgent')}
      </Button>
    </Flexbox>
  );
});

export default AddButton;
