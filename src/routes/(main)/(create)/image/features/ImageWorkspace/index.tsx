'use client';

import GenerationWorkspace from '@/routes/(main)/(create)/features/GenerationWorkspace';
import { useImageStore } from '@/store/image';
import { generationBatchSelectors, generationTopicSelectors } from '@/store/image/selectors';

import GenerationFeed from '../GenerationFeed';
import PromptInput from '../PromptInput';
import SkeletonList from './SkeletonList';

interface ImageWorkspaceProps {
  /** 为 false 时由页面级固定底部输入框渲染，不在此处嵌入（与 agent 布局一致） */
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
