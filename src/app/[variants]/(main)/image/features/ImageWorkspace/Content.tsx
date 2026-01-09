'use client';

import { useImageStore } from '@/store/image';
import { generationBatchSelectors, generationTopicSelectors } from '@/store/image/selectors';

import GenerationFeed from '../GenerationFeed';
import PromptInput from '../PromptInput';
import EmptyState from './EmptyState';
import SkeletonList from './SkeletonList';

const ImageWorkspaceContent = () => {
  const activeTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);
  const useFetchGenerationBatches = useImageStore((s) => s.useFetchGenerationBatches);
  const isCurrentGenerationTopicLoaded = useImageStore(
    generationBatchSelectors.isCurrentGenerationTopicLoaded,
  );
  useFetchGenerationBatches(activeTopicId);
  const currentBatches = useImageStore(generationBatchSelectors.currentGenerationBatches);
  const hasGenerations = currentBatches && currentBatches.length > 0;

  if (!isCurrentGenerationTopicLoaded) {
    return <SkeletonList />;
  }

  if (!hasGenerations) return <EmptyState />;

  return (
    <>
      {/* 生成结果展示区 */}
      <GenerationFeed key={activeTopicId} />

      {/* 底部输入框 */}
      <PromptInput disableAnimation={true} showTitle={false} />
    </>
  );
};

export default ImageWorkspaceContent;
