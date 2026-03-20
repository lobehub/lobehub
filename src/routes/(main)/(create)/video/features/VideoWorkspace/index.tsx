'use client';

import GenerationWorkspace from '@/routes/(main)/(create)/features/GenerationWorkspace';
import { useVideoStore } from '@/store/video';
import { generationBatchSelectors, videoGenerationTopicSelectors } from '@/store/video/selectors';

import GenerationFeed from '../GenerationFeed';
import PromptInput from '../PromptInput';
import SkeletonList from './SkeletonList';

interface VideoWorkspaceProps {
  embedInput?: boolean;
}

const VideoWorkspace = ({ embedInput = true }: VideoWorkspaceProps) => (
  <GenerationWorkspace
    GenerationFeed={GenerationFeed}
    PromptInput={PromptInput}
    SkeletonList={SkeletonList}
    embedInput={embedInput}
    useStore={useVideoStore}
    selectors={{
      activeGenerationTopicId: videoGenerationTopicSelectors.activeGenerationTopicId,
      currentGenerationBatches: generationBatchSelectors.currentGenerationBatches,
      isCurrentGenerationTopicLoaded: generationBatchSelectors.isCurrentGenerationTopicLoaded,
    }}
  />
);

export default VideoWorkspace;
