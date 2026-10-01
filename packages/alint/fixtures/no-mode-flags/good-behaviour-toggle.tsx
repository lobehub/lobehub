// Fixture: behaviour toggles and callbacks tune one capability, not a host.
import { Button, Input } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';

import { AgentPicker } from '@/features/AgentPicker';

interface CreateTaskEntryProps {
  defaultAgentId: string;
  disableSend?: boolean;
  lockAssignee?: boolean;
  onCreate: (title: string, agentId: string) => void;
}

const CreateTaskEntry = memo<CreateTaskEntryProps>(
  ({ defaultAgentId, disableSend, lockAssignee, onCreate }) => {
    const [title, setTitle] = useState('');
    const [agentId, setAgentId] = useState(defaultAgentId);

    return (
      <div>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        {!lockAssignee && <AgentPicker value={agentId} onChange={setAgentId} />}
        <Button disabled={disableSend || !title} onClick={() => onCreate(title, agentId)}>
          Create
        </Button>
      </div>
    );
  },
);

export default CreateTaskEntry;
