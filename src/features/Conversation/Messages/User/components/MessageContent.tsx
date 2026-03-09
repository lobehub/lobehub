import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { type UIChatMessage } from '@/types/index';

import { useMarkdown } from '../useMarkdown';
import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import PageSelections from './PageSelections';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, imageList, videoList, fileList, metadata }) => {
    const markdownProps = useMarkdown(id);
    const pageSelections = metadata?.pageSelections;
    const displayContent = useMemo(() => (content ? cleanSpeakerTag(content) : content), [content]);

    return (
      <Flexbox gap={8} id={id}>
        {pageSelections && pageSelections.length > 0 && (
          <PageSelections selections={pageSelections} />
        )}
        {displayContent && <MarkdownMessage {...markdownProps}>{displayContent}</MarkdownMessage>}
        {imageList && imageList?.length > 0 && <ImageFileListViewer items={imageList} />}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
        {fileList && fileList?.length > 0 && <FileListViewer items={fileList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
