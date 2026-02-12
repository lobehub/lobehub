import { type LobeToolRenderType } from '@lobechat/types';
import { type PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { memo } from 'react';

import { ToolErrorBoundary } from '@/features/Conversation/Messages/Tool/ErrorBoundary';

import BuiltinType from './BuiltinType';
import DefaultType from './DefaultType';
import Markdown from './MarkdownType';
import MCP from './MCPType';
import Standalone from './StandaloneType';

export interface PluginRenderProps {
  arguments?: string;
  content: string;
  identifier?: string;
  loading?: boolean;
  /**
   * The real message ID (tool message ID)
   */
  messageId?: string;
  payload?: PluginRequestPayload;
  pluginError?: any;
  pluginState?: any;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId?: string;
  type?: LobeToolRenderType;
}

const PluginRender = memo<PluginRenderProps>(
  ({
    content,
    arguments: argumentsStr = '',
    toolCallId,
    messageId,
    payload,
    pluginState,
    identifier,
    type,
    loading,
    pluginError,
  }) => {
    const renderContent = () => {
      switch (type) {
        case 'standalone': {
          return (
            <Standalone id={toolCallId || messageId || ''} name={identifier} payload={payload} />
          );
        }

        case 'builtin': {
          return (
            <BuiltinType
              apiName={payload?.apiName}
              arguments={argumentsStr}
              content={content}
              identifier={identifier}
              loading={loading}
              messageId={messageId}
              pluginError={pluginError}
              pluginState={pluginState}
              toolCallId={toolCallId}
            />
          );
        }

        // @ts-expect-error need to update types
        case 'mcp': {
          return (
            <MCP
              apiName={payload?.apiName}
              arguments={argumentsStr}
              content={content}
              identifier={identifier}
              loading={loading}
              messageId={messageId}
              pluginError={pluginError}
              pluginState={pluginState}
              toolCallId={toolCallId}
            />
          );
        }

        case 'markdown': {
          return <Markdown content={content} loading={loading} />;
        }

        default: {
          return <DefaultType content={content} loading={loading} name={identifier} />;
        }
      }
    };

    // Use stable key to prevent ErrorBoundary from resetting on parent re-renders
    const boundaryKey = `${identifier}-${payload?.apiName}-${toolCallId || messageId}`;

    return (
      <ToolErrorBoundary apiName={payload?.apiName} identifier={identifier} key={boundaryKey}>
        {renderContent()}
      </ToolErrorBoundary>
    );
  },
);

export default PluginRender;
