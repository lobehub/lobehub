import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import type {UIChatMessage} from '@/types/index';

import { useMarkdown } from '../useMarkdown';
import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import PageSelections from './PageSelections';
import VideoFileListViewer from './VideoFileListViewer';

const UserMessageContent = memo<UIChatMessage>(
  ({ id, content, imageList, videoList, fileList, metadata }) => {
    const markdownProps = useMarkdown(id);
    const pageSelections = metadata?.pageSelections;

    return (
      <Flexbox gap={8} id={id}>
        {pageSelections && pageSelections.length > 0 && (
          <PageSelections selections={pageSelections} />
        )}
        {content && <MarkdownMessage {...markdownProps}>{content}</MarkdownMessage>}
        {imageList && imageList?.length > 0 && <ImageFileListViewer items={imageList} />}
        {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
        {fileList && fileList?.length > 0 && <FileListViewer items={fileList} />}
      </Flexbox>
    );
  },
);

export default UserMessageContent;
