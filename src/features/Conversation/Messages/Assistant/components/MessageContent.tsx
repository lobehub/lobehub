import { LOADING_FLAT } from '@lobechat/const';
import { type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { CollapsedMessage } from '../../AssistantGroup/components/CollapsedMessage';
import DisplayContent from '../../components/DisplayContent';
import FileChunks from '../../components/FileChunks';
import ImageFileListViewer from '../../components/ImageFileListViewer';
import IntentUnderstanding from '../../components/IntentUnderstanding';
import Reasoning from '../../components/Reasoning';
import SearchGrounding from '../../components/SearchGrounding';
import { useMarkdown } from '../useMarkdown';

const MessageContent = memo<UIChatMessage>(
  ({ id, tools, content, chunksList, search, imageList, metadata, ...props }) => {
    const markdownProps = useMarkdown(id);
    // Use ConversationStore instead of ChatStore
    const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
    const isCollapsed = useConversationStore(messageStateSelectors.isMessageCollapsed(id));
    const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));

    const isToolCallGenerating = generating && (content === LOADING_FLAT || !content) && !!tools;

    // TODO: Need to implement isIntentUnderstanding selector in ConversationStore if needed
    const isIntentUnderstanding = false;

    const showSearch = !!search && !!search.citations?.length;
    const showImageItems = !!imageList && imageList.length > 0;

    // remove \n to avoid empty content
    // refs: https://github.com/lobehub/lobe-chat/pull/6153
    const showReasoning =
      (!!props.reasoning && props.reasoning.content?.trim() !== '') ||
      (!props.reasoning && isReasoning);

    const showFileChunks = !!chunksList && chunksList.length > 0;

    if (isCollapsed) return <CollapsedMessage content={content} id={id} />;

    return (
      <Flexbox gap={8} id={id}>
        {showSearch && (
          <SearchGrounding citations={search?.citations} searchQueries={search?.searchQueries} />
        )}
        {showFileChunks && <FileChunks data={chunksList} />}
        {showReasoning && <Reasoning {...props.reasoning} id={id} />}
        {isIntentUnderstanding ? (
          <IntentUnderstanding />
        ) : (
          <DisplayContent
            content={content}
            hasImages={showImageItems}
            isMultimodal={metadata?.isMultimodal}
            isToolCallGenerating={isToolCallGenerating}
            markdownProps={markdownProps}
            tempDisplayContent={metadata?.tempDisplayContent}
          />
        )}
        {showImageItems && <ImageFileListViewer items={imageList} />}
      </Flexbox>
    );
  },
);

export default MessageContent;
