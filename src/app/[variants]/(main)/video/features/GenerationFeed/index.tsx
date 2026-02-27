'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment, memo, useEffect, useRef } from 'react';

import { useVideoStore } from '@/store/video';
import { generationBatchSelectors } from '@/store/video/selectors';

import { VideoGenerationBatchItem } from './BatchItem';

const GenerationFeed = memo(() => {
  const [parent, enableAnimations] = useAutoAnimate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const prevBatchesCountRef = useRef(0);

  const currentGenerationBatches = useVideoStore(generationBatchSelectors.currentGenerationBatches);

  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    if (!containerRef.current) return;

    const scrollableParent =
      containerRef.current.closest('[style*="overflow"]') || document.documentElement;

    const targetRect = containerRef.current.getBoundingClientRect();
    const scrollableRect = scrollableParent.getBoundingClientRect();

    const scrollTop = scrollableParent.scrollTop + targetRect.bottom - scrollableRect.bottom + 999;

    scrollableParent.scrollTo({
      behavior: behavior,
      top: scrollTop,
    });
  };

  useEffect(() => {
    const currentBatches = currentGenerationBatches || [];
    const currentBatchesCount = currentBatches.length;
    const prevBatchesCount = prevBatchesCountRef.current;

    if (currentBatchesCount === 0) {
      prevBatchesCountRef.current = 0;
      return;
    }

    if (isInitialLoadRef.current) {
      scrollToBottom('auto');
      isInitialLoadRef.current = false;
    } else if (currentBatchesCount > prevBatchesCount) {
      enableAnimations(false);
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
        enableAnimations(true);
      }, 50);

      return () => clearTimeout(timer);
    }

    prevBatchesCountRef.current = currentBatchesCount;
  }, [currentGenerationBatches, enableAnimations]);

  if (!currentGenerationBatches || currentGenerationBatches.length === 0) {
    return null;
  }

  return (
    <Flexbox flex={1} style={{ overflowY: 'auto' }}>
      <Flexbox gap={16} ref={parent} style={{ paddingBottom: 48 }} width="100%">
        {currentGenerationBatches.map((batch, index) => (
          <Fragment key={batch.id}>
            {Boolean(index !== 0) && <Divider dashed style={{ margin: 0 }} />}
            <VideoGenerationBatchItem batch={batch} key={batch.id} />
          </Fragment>
        ))}
      </Flexbox>
      <div ref={containerRef} style={{ height: 1 }} />
    </Flexbox>
  );
});

GenerationFeed.displayName = 'GenerationFeed';

export default GenerationFeed;
