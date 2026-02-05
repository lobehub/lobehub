import type {ChatToolPayloadWithResult} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Tool from './Tool';

interface ToolsRendererProps {
  disableEditing?: boolean;
  messageId: string;
  tools: ChatToolPayloadWithResult[];
}

export const Tools = memo<ToolsRendererProps>(({ disableEditing, messageId, tools }) => {
  if (!tools || tools.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {tools.map((tool) => (
        <Tool
          apiName={tool.apiName}
          arguments={tool.arguments}
          assistantMessageId={messageId}
          disableEditing={disableEditing}
          id={tool.id}
          identifier={tool.identifier}
          intervention={tool.intervention}
          key={tool.id}
          result={tool.result}
          toolMessageId={tool.result_msg_id}
          type={tool.type}
        />
      ))}
    </Flexbox>
  );
});
