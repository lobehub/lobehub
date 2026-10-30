import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { type ChatPluginPayload } from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';
import { getMcpAppFromState, unwrapMcpToolState } from '@/libs/mcp/mcpApp';
import dynamic from '@/libs/next/dynamic';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { dataSelectors, useConversationStore } from '../../../../../store';
import CustomRender from './CustomRender';
import { FallbackArgumentRender } from './FallbacktArgumentRender';

const McpAppView = dynamic(() => import('@/features/MCPApp/McpAppView'), { ssr: false });

interface ToolRenderProps {
  content: string;
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  showCustomToolRender?: boolean;
  toolCallId: string;
}

const ToolRender = memo<ToolRenderProps>(
  ({ showCustomToolRender, content, messageId, plugin, pluginState, toolCallId }) => {
    const hasCustomRender = !!getBuiltinRender(plugin?.identifier, plugin?.apiName);
    const enableMcpApp = useServerConfigStore(serverConfigSelectors.enableMcpApp);

    // Tools whose card renders the stored body — the read path projected it away
    // and this component is where it comes back. Safe to fetch on mount: the
    // whole detail only mounts when the row is expanded, so a conversation load
    // asks for nothing.
    const needsStoredPayload = useConversationStore(
      (s) =>
        !!messageId && dataSelectors.getDbMessageById(messageId)(s)?.payloadOmitted === 'render',
    );
    const { isLoading, payload } = useToolResultPayload(messageId, needsStoredPayload);

    const resolvedContent = payload?.content ?? content;
    const resolvedState = payload?.pluginState ?? pluginState;

    if (needsStoredPayload && isLoading && !payload) {
      return (
        <Flexbox paddingBlock={8} width={'100%'}>
          <Skeleton height={96} width={'100%'} />
        </Flexbox>
      );
    }

    if (hasCustomRender && showCustomToolRender) {
      return (
        <CustomRender
          content={resolvedContent}
          messageId={messageId}
          plugin={plugin}
          pluginState={resolvedState}
          toolCallId={toolCallId}
        />
      );
    }

    const fallback = (
      <FallbackArgumentRender
        content={resolvedContent}
        requestArgs={plugin?.arguments}
        toolCallId={toolCallId}
      />
    );

    // MCP Apps: the tool declared an interactive `ui://` view for its result
    const mcpApp = enableMcpApp ? getMcpAppFromState(resolvedState) : undefined;
    if (mcpApp && showCustomToolRender && plugin) {
      return (
        <McpAppView
          apiName={plugin.apiName}
          arguments={plugin.arguments}
          fallback={fallback}
          identifier={plugin.identifier}
          resourceUri={mcpApp.resourceUri}
          result={{ content: resolvedContent, state: unwrapMcpToolState(resolvedState) }}
          toolCallId={toolCallId}
        />
      );
    }

    return fallback;
  },
);

ToolRender.displayName = 'ToolResultRender';

export default ToolRender;
