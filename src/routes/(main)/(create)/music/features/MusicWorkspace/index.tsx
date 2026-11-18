'use client';

import GenerationWorkspace from '@/routes/(main)/(create)/features/GenerationWorkspace';
import { useMusicStore } from '@/store/music';
import { generationBatchSelectors, musicGenerationTopicSelectors } from '@/store/music/selectors';

import GenerationFeed from '../GenerationFeed';
import PromptInput from '../PromptInput';
import SkeletonList from './SkeletonList';

interface MusicWorkspaceProps {
  embedInput?: boolean;
}

const MusicWorkspace = ({ embedInput = true }: MusicWorkspaceProps) => (
  <GenerationWorkspace
    GenerationFeed={GenerationFeed}
    PromptInput={PromptInput}
    SkeletonList={SkeletonList}
    embedInput={embedInput}
    useStore={useMusicStore}
    selectors={{
      activeGenerationTopicId: musicGenerationTopicSelectors.activeGenerationTopicId,
      currentGenerationBatches: generationBatchSelectors.currentGenerationBatches,
      generationTopics: musicGenerationTopicSelectors.generationTopics,
      isCurrentGenerationTopicLoaded: generationBatchSelectors.isCurrentGenerationTopicLoaded,
    }}
  />
);

export default MusicWorkspace;
