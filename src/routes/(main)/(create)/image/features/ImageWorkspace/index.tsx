'use client';

import GenerationWorkspace from '@/routes/(main)/(create)/features/GenerationWorkspace';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors, generationTopicSelectors } from '@/store/image/selectors';

import GenerationFeed from '../GenerationFeed';
import PromptInput from '../PromptInput';
import SkeletonList from './SkeletonList';

interface ImageWorkspaceProps {
  /** When false, rendered by the page-level fixed bottom input box, not embedded here (consistent with agent layout) */
  embedInput?: boolean;
}

const ImageWorkspace = ({ embedInput = true }: ImageWorkspaceProps) => (
  <GenerationWorkspace
    GenerationFeed={GenerationFeed}
    PromptInput={PromptInput}
    SkeletonList={SkeletonList}
    embedInput={embedInput}
    useStore={useImageStore}
    selectors={{
      activeGenerationTopicId: generationTopicSelectors.activeGenerationTopicId,
      currentGenerationBatches: generationBatchSelectors.currentGenerationBatches,
      isCurrentGenerationTopicLoaded: generationBatchSelectors.isCurrentGenerationTopicLoaded,
    }}
  />
);

export default ImageWorkspace;
