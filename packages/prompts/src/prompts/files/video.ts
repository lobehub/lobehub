import type { ChatVideoItem } from '@lobechat/types';
import { createVisualFileRef } from '@lobechat/types';

const videoPrompt = (
  item: ChatVideoItem,
  attachUrl: boolean,
  index: number,
  messageId?: string,
) => {
  const ref = createVisualFileRef({ index, messageId, type: 'video' });

  return attachUrl
    ? `<video ref="${ref}" name="${item.alt}" url="${item.url}"></video>`
    : `<video ref="${ref}" name="${item.alt}"></video>`;
};

export const videosPrompts = (
  videoList: ChatVideoItem[],
  addUrl: boolean = true,
  messageId?: string,
) => {
  if (videoList.length === 0) return '';

  const prompt = `<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
${videoList.map((item, index) => videoPrompt(item, addUrl, index, messageId)).join('\n')}
</videos>`;

  return prompt.trim();
};
