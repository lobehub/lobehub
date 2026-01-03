import { memo } from 'react';

import FileItemList from './FileList';

/**
 * Note: Drag upload is now handled by DragUploadZone in the parent Desktop component.
 */
const FilePreview = memo(() => {
  return <FileItemList />;
});

export default FilePreview;
