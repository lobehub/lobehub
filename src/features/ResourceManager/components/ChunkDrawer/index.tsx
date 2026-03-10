import { Flexbox } from '@lobehub/ui';
import { Drawer } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import dynamic from '@/libs/next/dynamic';
import { fileManagerSelectors, useFileStore } from '@/store/file';

import Content from './Content';

const FileViewer = dynamic(() => import('@/features/FileViewer'), { ssr: false });

/**
 * Showing the chunk info of a file
 */
const ChunkDrawer = memo(() => {
  const [fileId, open, closeChunkDrawer] = useFileStore((s) => [
    s.chunkDetailId,
    !!s.chunkDetailId,
    s.closeChunkDrawer,
  ]);
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));

  return (
    <Drawer
      open={open}
      size="large"
      title={file?.name}
      styles={{
        body: { padding: 0 },
      }}
      onClose={() => {
        closeChunkDrawer();
      }}
    >
      <Flexbox horizontal height={'100%'} style={{ overflow: 'hidden' }}>
        {file && (
          <Flexbox flex={2} style={{ overflow: 'scroll' }}>
            <FileViewer {...file} />
          </Flexbox>
        )}
        <Flexbox flex={1} style={{ borderInlineStart: `1px solid ${cssVar.colorSplit}` }}>
          <Content />
        </Flexbox>
      </Flexbox>
    </Drawer>
  );
});

export default ChunkDrawer;
