import { Button, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SESSION_CHAT_URL } from '@/const/url';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useServerConfigStore } from '@/store/serverConfig';

const AddButton = memo<{ groupId?: string }>(({ groupId }) => {
  const { t } = useTranslation('chat');
  const router = useQueryRoute();
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { mutate, isValidating } = useActionSWR(['agent.createAgent', groupId], async () => {
    const result = await createAgent({ groupId });
    await refreshAgentList();
    router.push(SESSION_CHAT_URL(result.agentId, mobile));
  });

  return (
    <Flexbox flex={1} padding={mobile ? 16 : 0}>
      <Button
        block
        icon={Plus}
        loading={isValidating}
        variant={'filled'}
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
