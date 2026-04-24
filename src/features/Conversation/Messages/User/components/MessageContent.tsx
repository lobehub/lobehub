import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { type UIChatMessage } from '@/types/index';

import { useMarkdown } from '../useMarkdown';
import CollapsibleContent from './CollapsibleContent';
import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import PageSelections from './PageSelections';
import RichTextMessage from './RichTextMessage';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, editorData, imageList, videoList, fileList, metadata }) => {
    const markdownProps = useMarkdown(id);
    const pageSelections = metadata?.pageSelections;
    const displayContent = useMemo(() => (content ? cleanSpeakerTag(content) : content), [content]);

    const hasEditorData =
      editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

    const textBody = hasEditorData ? (
      <RichTextMessage editorState={editorData} />
    ) : (
      displayContent && <MarkdownMessage {...markdownProps}>{displayContent}</MarkdownMessage>
    );

    return (
      <Flexbox gap={8} id={id}>
        {pageSelections && pageSelections.length > 0 && (
          <PageSelections selections={pageSelections} />
        )}
        {textBody && <CollapsibleContent>{textBody}</CollapsibleContent>}
        {imageList && imageList?.length > 0 && <ImageFileListViewer items={imageList} />}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
        {fileList && fileList?.length > 0 && <FileListViewer items={fileList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
