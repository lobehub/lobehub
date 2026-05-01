import type { ChatVideoItem } from '@lobechat/types';

const videoPrompt = (item: ChatVideoItem, attachUrl: boolean, index: number) =>
  attachUrl
    ? `<video ref="video_${index + 1}" name="${item.alt}" url="${item.url}"></video>`
    : `<video ref="video_${index + 1}" name="${item.alt}"></video>`;

export const videosPrompts = (videoList: ChatVideoItem[], addUrl: boolean = true) => {
  if (videoList.length === 0) return '';

  const prompt = `<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
${videoList.map((item, index) => videoPrompt(item, addUrl, index)).join('\n')}
</videos>`;

  return prompt.trim();
};
