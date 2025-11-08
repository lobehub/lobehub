import { ChatFileItem } from '@lobechat/types';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileItem from './Item';

interface FileListViewerProps {
  items: ChatFileItem[];
}

const FileListViewer = memo<FileListViewerProps>(({ items }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <FileItem key={item.id} {...item} />
      ))}
    </Flexbox>
  );
});
export default FileListViewer;
