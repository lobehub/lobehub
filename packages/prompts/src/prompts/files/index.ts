import type { ChatFileItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';

import { filePrompts } from './file';
import { imagesPrompts } from './image';
import { videosPrompts } from './video';

export type { KnowledgeBaseInfo, PromptKnowledgeOptions } from './knowledgeBase';
export { promptAgentKnowledge } from './knowledgeBase';

export const filesPrompts = ({
  imageList,
  fileList,
  videoList,
  addUrl = true,
}: {
  addUrl?: boolean;
  fileList?: ChatFileItem[];
  imageList?: ChatImageItem[];
  videoList?: ChatVideoItem[];
}) => {
  const hasImages = (imageList || []).length > 0;
  const hasFiles = (fileList || []).length > 0;
  const hasVideos = (videoList || []).length > 0;

  if (!hasImages && !hasFiles && !hasVideos) return '';

  const contentParts = [
    hasImages ? imagesPrompts(imageList!, addUrl) : '',
    hasFiles ? filePrompts(fileList!, addUrl) : '',
    hasVideos ? videosPrompts(videoList!, addUrl) : '',
  ].filter(Boolean);

  const prompt = `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
${contentParts.join('\n')}
</files_info>
<!-- END SYSTEM CONTEXT -->`;

  return prompt.trim();
};
