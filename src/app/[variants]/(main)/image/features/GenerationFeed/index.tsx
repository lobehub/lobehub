'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment, memo, useEffect, useRef } from 'react';

import { useImageStore } from '@/store/image';
import { generationBatchSelectors } from '@/store/image/selectors';

import { GenerationBatchItem } from './BatchItem';

const GenerationFeed = memo(() => {
  const [parent, enableAnimations] = useAutoAnimate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const prevBatchesCountRef = useRef(0);

  const currentGenerationBatches = useImageStore(generationBatchSelectors.currentGenerationBatches);

  // Smart scroll function that accounts for sticky elements
  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    if (!containerRef.current) return;

    // Find the main scrollable container (usually the parent of the sticky element)
    const scrollableParent =
      containerRef.current.closest('[style*="overflow"]') || document.documentElement;

    // Get the position of our target element
    const targetRect = containerRef.current.getBoundingClientRect();
    const scrollableRect = scrollableParent.getBoundingClientRect();

    // Calculate the scroll position, adding extra offset for sticky elements
    // The 120px accounts for typical sticky input height + some padding
    const scrollTop = scrollableParent.scrollTop + targetRect.bottom - scrollableRect.bottom + 999;

    scrollableParent.scrollTo({
      behavior: behavior,
      top: scrollTop,
    });
  };

  // Auto-scroll to bottom, with different behavior for initial load vs. updates
  useEffect(() => {
    const currentBatches = currentGenerationBatches || [];
    const currentBatchesCount = currentBatches.length;
    const prevBatchesCount = prevBatchesCountRef.current;

    if (currentBatchesCount === 0) {
      prevBatchesCountRef.current = 0;
      return;
    }

    if (isInitialLoadRef.current) {
      // On initial load, scroll instantly to the end.
      scrollToBottom('auto');
      isInitialLoadRef.current = false;
    } else if (currentBatchesCount > prevBatchesCount) {
      // For subsequent updates where a batch was ADDED, scroll smoothly.
      enableAnimations(false);
      // Wait for React to re-render without animations.
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
        // Re-enable animations for future interactions like deleting items.
        enableAnimations(true);
      }, 50); // A small delay is enough.

      return () => clearTimeout(timer);
    }

    // Always update the ref with the latest count for the next render.
    prevBatchesCountRef.current = currentBatchesCount;
  }, [currentGenerationBatches, enableAnimations]);

  if (!currentGenerationBatches || currentGenerationBatches.length === 0) {
    return null;
  }

  return (
    <Flexbox flex={1}>
      <Flexbox gap={16} ref={parent} width="100%">
        {currentGenerationBatches.map((batch, index) => (
          <Fragment key={batch.id}>
            {Boolean(index !== 0) && <Divider dashed style={{ margin: 0 }} />}
            <GenerationBatchItem batch={batch} key={batch.id} />
          </Fragment>
        ))}
      </Flexbox>
      {/* Invisible element for scroll target */}
      <div ref={containerRef} style={{ height: 1 }} />
    </Flexbox>
  );
});

GenerationFeed.displayName = 'GenerationFeed';

export default GenerationFeed;
