import { ManagedMcpAppView } from '@/features/MCPApp/ManagedMcpAppView';
import type { McpAppViewProps } from '@/features/MCPApp/McpAppView';
import { useMcpAppIdentity } from '@/features/MCPApp/useMcpAppIdentity';
import { mcpAppAgentIdSelector } from '@/features/MCPApp/viewAgent';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useConversationStore } from '../../../../../store';

export const InlineMcpAppView = (
  props: Omit<McpAppViewProps, 'host'> & { preferred?: 'inline' | 'fullscreen' },
) => {
  const agentId = useConversationStore(mcpAppAgentIdSelector(props.messageId));
  const [title, icon] = useMcpAppIdentity(props.identifier, agentId);
  const canSendMessage = useConversationStore((s) => s.composerTarget.writable);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const scope = useConversationStore((s) => messageMapKey(s.context));
  return (
    <ManagedMcpAppView
      {...props}
      host={{ agentId, canSendMessage, sendMessage }}
      icon={icon}
      location={'inline'}
      scope={scope}
      title={title}
    />
  );
};
