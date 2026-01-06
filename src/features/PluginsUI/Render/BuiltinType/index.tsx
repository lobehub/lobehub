import { safeParseJSON } from '@lobechat/utils';
import { memo } from 'react';

import { getBuiltinRender } from '@/tools/renders';

import { useParseContent } from '../useParseContent';

export interface BuiltinTypeProps {
  apiName?: string;
  arguments?: string;
  content: string;
  identifier?: string;
  loading?: boolean;
  /**
   * The real message ID (tool message ID)
   */
  messageId?: string;
  pluginError?: any;
  pluginState?: any;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId?: string;
}

const BuiltinType = memo<BuiltinTypeProps>(
  ({
    content,
    arguments: argumentsStr = '',
    pluginState,
    toolCallId,
    messageId,
    identifier,
    pluginError,
    apiName,
  }) => {
    const { data } = useParseContent(content);

    const Render = getBuiltinRender(identifier, apiName);

    if (!Render) return;

    const args = safeParseJSON(argumentsStr);

    return (
      <Render
        apiName={apiName}
        args={args || {}}
        content={data}
        identifier={identifier}
        messageId={messageId || toolCallId || ''}
        pluginError={pluginError}
        pluginState={pluginState}
        toolCallId={toolCallId}
      />
    );
  },
);

export default BuiltinType;
