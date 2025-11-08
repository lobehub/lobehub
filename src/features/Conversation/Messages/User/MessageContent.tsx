import { UIChatMessage } from '@lobechat/types';
import { ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileListViewer from './FileListViewer';
import ImageFileListViewer from './ImageFileListViewer';
import VideoFileListViewer from './VideoFileListViewer';

export const UserMessageContent = memo<
  UIChatMessage & {
    editableContent: ReactNode;
  }
>(({ id, editableContent, imageList, videoList, fileList }) => {
  return (
    <Flexbox gap={8} id={id}>
      {editableContent}
      {imageList && imageList?.length > 0 && <ImageFileListViewer items={imageList} />}
      {videoList && videoList?.length > 0 && <VideoFileListViewer items={videoList} />}
      {fileList && fileList?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <FileListViewer items={fileList} />
        </div>
      )}
    </Flexbox>
  );
});
