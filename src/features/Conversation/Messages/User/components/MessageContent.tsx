import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import CollapsibleContent from '@/components/CollapsibleContent';
import MarkdownMessage from '@/features/Conversation/Markdown';
import { StartTopicConversationContext } from '@/features/LocalFile';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { splitReferencedMessage } from '@/store/chat/utils/parseReferencedMessage';
import { type UIChatMessage } from '@/types/index';

import { useStartTopicConversation } from '../../../hooks/useStartTopicConversation';
import { useMarkdown } from '../useMarkdown';
import AudioFileListViewer from './AudioFileListViewer';
import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import PageSelections from './PageSelections';
import ReferencedMessage from './ReferencedMessage';
import RichTextMessage from './RichTextMessage';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, editorData, imageList, videoList, audioList, fileList, metadata }) => {
    const markdownProps = useMarkdown(id);
    const startTopicConversation = useStartTopicConversation();
    const selections = metadata?.contextSelections?.length
      ? metadata.contextSelections
      : metadata?.pageSelections;
    // IM-bot inbound rows carry prompt markup ahead of the user's text: a
    // `<speaker/>` tag (dropped; the sender is shown in the bubble header) and
    // an optional `<referenced_message>` block (rendered as a quote below).
    const { displayContent, reference } = useMemo(() => {
      if (!content) return { displayContent: content, reference: undefined };
      const { body, reference } = splitReferencedMessage(cleanSpeakerTag(content));
      return { displayContent: body, reference };
    }, [content]);

    const hasEditorData =
      editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

    const textBody = hasEditorData ? (
      // Rich-text folder chips render headlessly, so they receive the
      // conversation through context rather than props.
      <StartTopicConversationContext value={startTopicConversation}>
        <RichTextMessage editorState={editorData} />
      </StartTopicConversationContext>
    ) : (
      displayContent && <MarkdownMessage {...markdownProps}>{displayContent}</MarkdownMessage>
    );

    return (
      <Flexbox gap={8} id={id}>
        {selections && selections.length > 0 && <PageSelections selections={selections} />}
        {reference && <ReferencedMessage reference={reference} />}
        {textBody && <CollapsibleContent>{textBody}</CollapsibleContent>}
        {imageList && imageList?.length > 0 && <ImageFileListViewer items={imageList} />}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
        {audioList && audioList?.length > 0 && (
          <AudioFileListViewer items={audioList} messageId={id} />
        )}
        {fileList && fileList?.length > 0 && <FileListViewer items={fileList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
