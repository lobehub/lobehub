import { LOADING_FLAT } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { Suspense, memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import CustomRender from './CustomRender';
import ErrorResponse from './ErrorResponse';
import LoadingPlaceholder from './LoadingPlaceholder';

interface RenderProps {
  apiName: string;
  identifier: string;
  messageId: string;
  requestArgs?: string;
  setShowPluginRender: (show: boolean) => void;
  showPluginRender: boolean;
  toolCallId: string;
  toolIndex: number;
}

const Render = memo<RenderProps>(
  ({
    toolCallId,
    toolIndex,
    messageId,
    requestArgs,
    showPluginRender,
    setShowPluginRender,
    identifier,
    apiName,
  }) => {
    const loading = useChatStore(chatSelectors.isToolCallStreaming(messageId, toolIndex));
    const toolMessage = useChatStore(chatSelectors.getMessageByToolCallId(toolCallId), isEqual);

    if (loading || !toolMessage) return null;

    if (!!toolMessage) {
      if (toolMessage.error) {
        return <ErrorResponse {...toolMessage.error} id={messageId} plugin={toolMessage.plugin} />;
      }

      const placeholder = (
        <LoadingPlaceholder
          apiName={apiName}
          identifier={identifier}
          loading
          requestArgs={requestArgs}
        />
      );

      // 如果是 LOADING_FLAT 则说明还在加载中
      // 而 standalone 模式的插件 content 应该始终是 LOADING_FLAT
      const inPlaceholder =
        toolMessage.content === LOADING_FLAT && toolMessage.plugin?.type !== 'standalone';

      if (inPlaceholder) return placeholder;

      return (
        <Suspense fallback={placeholder}>
          <CustomRender
            {...toolMessage}
            requestArgs={requestArgs}
            setShowPluginRender={setShowPluginRender}
            showPluginRender={showPluginRender}
          />
        </Suspense>
      );
    }
  },
);

Render.displayName = 'ToolRender';

export default Render;
