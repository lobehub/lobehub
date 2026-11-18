import type { McpUiEmbeddedResource } from '@lobechat/const/mcpApp';
import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';

import McpUiResourceView, {
  buildMcpUiFrameDocument,
  type McpUiResourceViewProps,
} from '@/features/MCPApp/McpUiResourceView';
import { mcpAppAgentIdSelector } from '@/features/MCPApp/viewAgent';

import { useConversationStore } from '../../../../../store';

export const InlineMcpUiViews = ({
  fallback,
  messageId,
  resources,
  ...props
}: Omit<McpUiResourceViewProps, 'host' | 'resource'> & {
  fallback: ReactNode;
  messageId?: string;
  resources: McpUiEmbeddedResource[];
}) => {
  const agentId = useConversationStore(mcpAppAgentIdSelector(messageId));
  const canSendMessage = useConversationStore((s) => s.composerTarget.writable);
  const sendMessage = useConversationStore((s) => s.sendMessage);

  // An external page this host refuses (LobeHub's own origin, plain http
  // elsewhere) renders nothing: with none left, the plain result shows
  const renderable = resources.filter(
    (resource) => !!buildMcpUiFrameDocument(resource, window.location.origin),
  );
  if (!renderable.length) return fallback;

  return (
    <Flexbox gap={8} width={'100%'}>
      {renderable.map((resource, index) => (
        <McpUiResourceView
          {...props}
          host={{ agentId, canSendMessage, sendMessage }}
          key={`${index}:${resource.uri}`}
          resource={resource}
        />
      ))}
    </Flexbox>
  );
};
