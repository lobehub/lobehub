import { Button, Icon } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useActionSWR } from '@/libs/swr';
import { useAgentStore } from '@/store/agent';

const AddButton = memo(() => {
  const navigate = useNavigate();
  const createAgent = useAgentStore((s) => s.createAgent);
  const { mutate, isValidating } = useActionSWR('agent.createAgent', async () => {
    const result = await createAgent({});
    navigate(`/agent/${result.agentId}/profile`);
    return result;
  });

  return (
    <Button
      icon={<Icon icon={Plus} size={'small'} />}
      loading={isValidating}
      onClick={() => mutate()}
      style={{
        alignItems: 'center',
        borderRadius: 4,
        height: '20px',
        justifyContent: 'center',
        padding: '0 1px',
        width: '20px',
      }}
      variant={'filled'}
    />
  );
});

export default AddButton;
