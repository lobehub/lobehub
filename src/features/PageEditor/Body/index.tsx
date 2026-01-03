'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';

import EditorCanvas from '../EditorCanvas';
import { usePageEditorStore } from '../store';
import Title from './Title';

const styles = createStaticStyles(({ css, cssVar }) => ({
  loadingOverlay: css`
    position: absolute;
    z-index: 10;
    inset: 0;

    padding: 24px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const Body = memo(() => {
  const isLoadingContent = usePageEditorStore((s) => s.isLoadingContent);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Only show skeleton if loading takes more than 1 second
  useEffect(() => {
    // eslint-disable-next-line no-undef
    let timer: NodeJS.Timeout;

    if (isLoadingContent) {
      timer = setTimeout(() => {
        setShowSkeleton(true);
      }, 1000);
    } else {
      setShowSkeleton(false);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoadingContent]);

  return (
    <Flexbox flex={1} style={{ overflowY: 'auto', position: 'relative' }}>
      <Title />
      <EditorCanvas />
      {/* Show overlay immediately to hide old content */}
      {isLoadingContent && (
        <div className={styles.loadingOverlay}>
          {/* Only show skeleton after 1 second */}
          {showSkeleton && (
            <Flexbox gap={16}>
              <Skeleton.Title width="80%" />
              <Skeleton.Title width="60%" />
              <Skeleton.Title width="70%" />
              <Skeleton.Title width="50%" />
              <Skeleton.Title width="65%" />
            </Flexbox>
          )}
        </div>
      )}
    </Flexbox>
  );
});

export default Body;
