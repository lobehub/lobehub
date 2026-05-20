'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

interface FileTreeSkeletonProps {
  rows?: number;
  showRootFile?: boolean;
}

const ROW_HEIGHT = 28;

const FileTreeSkeleton = memo<FileTreeSkeletonProps>(({ rows = 8, showRootFile = true }) => {
  const skeletonRows = Array.from({ length: rows }, (_, index) => index);

  return (
    <Flexbox gap={2}>
      {showRootFile && (
        <Flexbox horizontal align={'center'} gap={6} height={ROW_HEIGHT} paddingInline={8}>
          <Skeleton.Button
            active
            size={'small'}
            style={{
              borderRadius: cssVar.borderRadius,
              height: 14,
              minWidth: 14,
              width: 14,
            }}
          />
          <Skeleton.Button
            active
            size={'small'}
            style={{
              borderRadius: cssVar.borderRadius,
              height: 16,
              minWidth: 80,
              opacity: 0.6,
              width: '40%',
            }}
          />
        </Flexbox>
      )}
      {skeletonRows.map((rowIndex) => {
        const depth = rowIndex % 3;
        const width = `${40 + ((rowIndex * 13) % 45)}%`;

        return (
          <Flexbox
            horizontal
            align={'center'}
            gap={6}
            height={ROW_HEIGHT}
            key={rowIndex}
            paddingInline={8}
            style={{ paddingInlineStart: 8 + depth * 16 }}
          >
            <Skeleton.Button
              active
              size={'small'}
              style={{
                borderRadius: cssVar.borderRadius,
                height: 14,
                minWidth: 14,
                width: 14,
              }}
            />
            <Skeleton.Button
              active
              size={'small'}
              style={{
                borderRadius: cssVar.borderRadius,
                height: 16,
                minWidth: 70,
                opacity: 0.55,
                width,
              }}
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

FileTreeSkeleton.displayName = 'FileTreeSkeleton';

export default FileTreeSkeleton;
