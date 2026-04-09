import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import { memo } from 'react';

import ShareTopicPreview from '@/features/ShareModal/ShareImage/Preview';

import { type FieldType } from './type';

interface PreviewProps extends FieldType {
  context: ConversationContext;
  message: UIChatMessage;
  previewId?: string;
  title?: string;
}

const Preview = memo<PreviewProps>(
  ({ context, message, previewId = 'preview', title, ...fieldValue }) => {
    return (
      <ShareTopicPreview
        {...fieldValue}
        context={context}
        headerAgentId={message.agentId}
        messages={[message]}
        previewId={previewId}
        title={title}
        withPluginInfo={false}
        withSystemRole={false}
      />
    );
  },
);

export default Preview;
